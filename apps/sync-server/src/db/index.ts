import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("DATABASE_URL not set - database features will be unavailable");
}

// Create postgres client (lazy connection)
const client = connectionString ? postgres(connectionString) : null;

// Create drizzle instance
export const db = client ? drizzle(client, { schema }) : null;

/**
 * Check if the database connection is healthy
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  if (!client) return false;

  try {
    await client`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.end();
  }
}
