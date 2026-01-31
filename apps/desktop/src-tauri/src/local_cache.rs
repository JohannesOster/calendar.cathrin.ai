use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Wry};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CacheError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Path error: {0}")]
    Path(String),
    #[error("Lock error")]
    Lock,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedEvent {
    pub id: String,
    pub calendar_id: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub is_all_day: bool,
    pub color: String,
    pub provider: String,
}

/// Local SQLite cache for offline event access
pub struct LocalCache {
    conn: Mutex<Connection>,
}

impl LocalCache {
    /// Create a new LocalCache, initializing the database if needed
    pub fn new(app: &AppHandle<Wry>) -> Result<Self, CacheError> {
        let app_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| CacheError::Path(e.to_string()))?;

        // Ensure directory exists
        std::fs::create_dir_all(&app_dir)
            .map_err(|e| CacheError::Path(e.to_string()))?;

        let db_path = app_dir.join("events_cache.db");
        let conn = Connection::open(db_path)?;

        // Initialize schema
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS cached_events (
                id TEXT PRIMARY KEY,
                calendar_id TEXT NOT NULL,
                title TEXT NOT NULL,
                start TEXT NOT NULL,
                end TEXT NOT NULL,
                is_all_day INTEGER DEFAULT 0,
                color TEXT,
                provider TEXT NOT NULL,
                cached_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_events_dates ON cached_events(start, end);
            CREATE INDEX IF NOT EXISTS idx_events_calendar ON cached_events(calendar_id);

            CREATE TABLE IF NOT EXISTS cache_metadata (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            "#,
        )?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Get events within a date range
    pub fn get_events(&self, start: &str, end: &str) -> Result<Vec<CachedEvent>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;

        let mut stmt = conn.prepare(
            "SELECT id, calendar_id, title, start, end, is_all_day, color, provider
             FROM cached_events
             WHERE start <= ?1 AND end >= ?2
             ORDER BY start",
        )?;

        let events = stmt
            .query_map(params![end, start], |row| {
                Ok(CachedEvent {
                    id: row.get(0)?,
                    calendar_id: row.get(1)?,
                    title: row.get(2)?,
                    start: row.get(3)?,
                    end: row.get(4)?,
                    is_all_day: row.get::<_, i32>(5)? != 0,
                    color: row.get(6)?,
                    provider: row.get(7)?,
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(events)
    }

    /// Insert or update events in the cache
    pub fn upsert_events(&self, events: &[CachedEvent]) -> Result<usize, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let mut count = 0;
        for event in events {
            conn.execute(
                "INSERT OR REPLACE INTO cached_events
                 (id, calendar_id, title, start, end, is_all_day, color, provider, cached_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    event.id,
                    event.calendar_id,
                    event.title,
                    event.start,
                    event.end,
                    event.is_all_day as i32,
                    event.color,
                    event.provider,
                    now,
                ],
            )?;
            count += 1;
        }

        Ok(count)
    }

    /// Delete events older than the specified number of days
    pub fn prune_old_events(&self, days_to_keep: i64) -> Result<usize, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;

        let cutoff = chrono::Utc::now() - chrono::Duration::days(days_to_keep);
        let cutoff_str = cutoff.to_rfc3339();

        let deleted = conn.execute(
            "DELETE FROM cached_events WHERE end < ?1",
            params![cutoff_str],
        )?;

        Ok(deleted)
    }

    /// Delete events within a specific date range
    /// Used to evict events for specific weeks from the cache
    pub fn delete_events_in_range(&self, start: &str, end: &str) -> Result<usize, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;

        // Delete events that overlap with the given range
        // An event overlaps if it starts before the range ends AND ends after the range starts
        let deleted = conn.execute(
            "DELETE FROM cached_events WHERE start <= ?1 AND end >= ?2",
            params![end, start],
        )?;

        Ok(deleted)
    }

    /// Clear all cached events
    pub fn clear(&self) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        conn.execute("DELETE FROM cached_events", [])?;
        Ok(())
    }

    /// Get cache metadata value
    pub fn get_metadata(&self, key: &str) -> Result<Option<String>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM cache_metadata WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .ok();
        Ok(value)
    }

    /// Set cache metadata value
    pub fn set_metadata(&self, key: &str, value: &str) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        conn.execute(
            "INSERT OR REPLACE INTO cache_metadata (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    /// Delete cache metadata value
    pub fn delete_metadata(&self, key: &str) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        conn.execute("DELETE FROM cache_metadata WHERE key = ?1", params![key])?;
        Ok(())
    }
}
