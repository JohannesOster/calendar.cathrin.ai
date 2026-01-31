use tauri::{Emitter, Manager};

mod calendar_api;
mod commands;
mod local_cache;
mod oauth;
mod storage;

use commands::{
    cache_events_locally, clear_cached_events, clear_local_cache, clear_session_token,
    delete_cached_weeks, ensure_valid_token, fetch_events, fetch_events_for_week,
    get_cached_events, get_connected_accounts, get_local_cached_events, get_session_token,
    init_local_cache, open_url, prune_local_cache, refresh_account_calendars, remove_account,
    save_session_token, start_oauth_flow, toggle_calendar_visibility,
};

#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;
#[cfg(target_os = "macos")]
use objc2::{define_class, msg_send, sel, AllocAnyThread};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowButton};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObject, NSObjectProtocol, NSString};

/// Set the visibility of macOS traffic light buttons (close, minimize, zoom)
#[cfg(target_os = "macos")]
fn set_traffic_lights_visible(ns_window: *mut AnyObject, visible: bool) {
    unsafe {
        let window: &NSWindow = &*(ns_window as *const NSWindow);
        let buttons = [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ];
        for button_kind in buttons {
            if let Some(button) = window.standardWindowButton(button_kind) {
                button.setHidden(!visible);
            }
        }
    }
}

#[cfg(target_os = "macos")]
struct FullscreenObserverContext {
    ns_window: *mut AnyObject,
    app_handle: tauri::AppHandle,
}

#[cfg(target_os = "macos")]
unsafe impl Send for FullscreenObserverContext {}
#[cfg(target_os = "macos")]
unsafe impl Sync for FullscreenObserverContext {}

#[cfg(target_os = "macos")]
static mut OBSERVER_CONTEXT: Option<Box<FullscreenObserverContext>> = None;

/// Static storage to keep the observer alive (NSNotificationCenter holds weak reference)
#[cfg(target_os = "macos")]
static mut OBSERVER_INSTANCE: Option<Retained<FullscreenObserver>> = None;

#[cfg(target_os = "macos")]
fn handle_will_exit_fullscreen_impl() {
    unsafe {
        if let Some(ref ctx) = OBSERVER_CONTEXT {
            // Hide traffic lights BEFORE the animation starts
            set_traffic_lights_visible(ctx.ns_window, false);

            // Emit event to frontend to move button immediately
            let _ = ctx.app_handle.emit("fullscreen-changed", false);
        }
    }
}

#[cfg(target_os = "macos")]
fn handle_did_exit_fullscreen_impl() {
    unsafe {
        if let Some(ref ctx) = OBSERVER_CONTEXT {
            // Show traffic lights after animation completes + delay for toggle button animation (200ms)
            let ns_window_ptr = ctx.ns_window as usize;
            dispatch::Queue::main().exec_after(
                std::time::Duration::from_millis(200),
                move || {
                    let ns_window = ns_window_ptr as *mut AnyObject;
                    set_traffic_lights_visible(ns_window, true);
                },
            );
        }
    }
}

#[cfg(target_os = "macos")]
fn handle_will_enter_fullscreen_impl() {
    unsafe {
        if let Some(ref ctx) = OBSERVER_CONTEXT {
            // Notify frontend that fullscreen transition is starting
            // Frontend will show traffic light outlines during the animation
            let _ = ctx.app_handle.emit("fullscreen-transition-start", ());
        }
    }
}

#[cfg(target_os = "macos")]
fn handle_did_enter_fullscreen_impl() {
    unsafe {
        if let Some(ref ctx) = OBSERVER_CONTEXT {
            // Emit event to frontend after macOS animation completes
            // This allows the CSS transition to run smoothly
            let _ = ctx.app_handle.emit("fullscreen-changed", true);
        }
    }
}

#[cfg(target_os = "macos")]
fn handle_did_become_main_impl() {
    unsafe {
        if let Some(ref ctx) = OBSERVER_CONTEXT {
            // Window gained focus
            let _ = ctx.app_handle.emit("window-focus-changed", true);
        }
    }
}

#[cfg(target_os = "macos")]
fn handle_did_resign_main_impl() {
    unsafe {
        if let Some(ref ctx) = OBSERVER_CONTEXT {
            // Window lost focus
            let _ = ctx.app_handle.emit("window-focus-changed", false);
        }
    }
}

#[cfg(target_os = "macos")]
define_class!(
    #[unsafe(super(NSObject))]
    #[name = "FullscreenObserver"]
    #[ivars = ()]
    struct FullscreenObserver;

    unsafe impl NSObjectProtocol for FullscreenObserver {}

    impl FullscreenObserver {
        #[unsafe(method(windowWillExitFullScreen:))]
        fn _window_will_exit_fullscreen(&self, _notification: *mut NSNotification) {
            handle_will_exit_fullscreen_impl();
        }

        #[unsafe(method(windowDidExitFullScreen:))]
        fn _window_did_exit_fullscreen(&self, _notification: *mut NSNotification) {
            handle_did_exit_fullscreen_impl();
        }

        #[unsafe(method(windowWillEnterFullScreen:))]
        fn _window_will_enter_fullscreen(&self, _notification: *mut NSNotification) {
            handle_will_enter_fullscreen_impl();
        }

        #[unsafe(method(windowDidEnterFullScreen:))]
        fn _window_did_enter_fullscreen(&self, _notification: *mut NSNotification) {
            handle_did_enter_fullscreen_impl();
        }

        #[unsafe(method(windowDidBecomeMain:))]
        fn _window_did_become_main(&self, _notification: *mut NSNotification) {
            handle_did_become_main_impl();
        }

        #[unsafe(method(windowDidResignMain:))]
        fn _window_did_resign_main(&self, _notification: *mut NSNotification) {
            handle_did_resign_main_impl();
        }
    }
);

#[cfg(target_os = "macos")]
impl FullscreenObserver {
    fn new() -> Retained<Self> {
        let this = Self::alloc();
        unsafe { msg_send![this, init] }
    }
}

#[cfg(target_os = "macos")]
fn register_fullscreen_observer(ns_window: *mut AnyObject, app_handle: tauri::AppHandle) {
    unsafe {
        // Store context for callbacks
        OBSERVER_CONTEXT = Some(Box::new(FullscreenObserverContext {
            ns_window,
            app_handle,
        }));

        // Create observer instance and store it to keep alive
        let observer = FullscreenObserver::new();
        OBSERVER_INSTANCE = Some(observer.clone());

        // Get notification center
        let notification_center = NSNotificationCenter::defaultCenter();

        // Create notification name strings
        let will_exit_name = NSString::from_str("NSWindowWillExitFullScreenNotification");
        let did_exit_name = NSString::from_str("NSWindowDidExitFullScreenNotification");
        let will_enter_name = NSString::from_str("NSWindowWillEnterFullScreenNotification");
        let did_enter_name = NSString::from_str("NSWindowDidEnterFullScreenNotification");

        // Cast window pointer for use as notification object
        let window_object: &AnyObject = &*(ns_window as *const AnyObject);

        // Cast observer to AnyObject for the notification center API
        let observer_ref: &AnyObject = &**observer;

        notification_center.addObserver_selector_name_object(
            observer_ref,
            sel!(windowWillExitFullScreen:),
            Some(&will_exit_name),
            Some(window_object),
        );

        notification_center.addObserver_selector_name_object(
            observer_ref,
            sel!(windowDidExitFullScreen:),
            Some(&did_exit_name),
            Some(window_object),
        );

        notification_center.addObserver_selector_name_object(
            observer_ref,
            sel!(windowWillEnterFullScreen:),
            Some(&will_enter_name),
            Some(window_object),
        );

        notification_center.addObserver_selector_name_object(
            observer_ref,
            sel!(windowDidEnterFullScreen:),
            Some(&did_enter_name),
            Some(window_object),
        );

        // Window focus notifications
        let did_become_main_name = NSString::from_str("NSWindowDidBecomeMainNotification");
        let did_resign_main_name = NSString::from_str("NSWindowDidResignMainNotification");

        notification_center.addObserver_selector_name_object(
            observer_ref,
            sel!(windowDidBecomeMain:),
            Some(&did_become_main_name),
            Some(window_object),
        );

        notification_center.addObserver_selector_name_object(
            observer_ref,
            sel!(windowDidResignMain:),
            Some(&did_resign_main_name),
            Some(window_object),
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load environment variables from .env file (if it exists)
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            start_oauth_flow,
            get_connected_accounts,
            remove_account,
            toggle_calendar_visibility,
            refresh_account_calendars,
            ensure_valid_token,
            fetch_events,
            fetch_events_for_week,
            get_cached_events,
            clear_cached_events,
            save_session_token,
            get_session_token,
            clear_session_token,
            open_url,
            // Local SQLite cache commands
            get_local_cached_events,
            cache_events_locally,
            clear_local_cache,
            prune_local_cache,
            delete_cached_weeks,
        ])
        .setup(|app| {
            // Initialize local SQLite cache
            if let Err(e) = init_local_cache(app.handle()) {
                eprintln!("Failed to initialize local cache: {}", e);
            }

            #[cfg(target_os = "macos")]
            {
                let app_handle = app.handle().clone();

                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(ns_window_ptr) = window.ns_window() {
                        let ns_window = ns_window_ptr as *mut AnyObject;

                        // Register NSNotificationCenter observers for fullscreen events
                        // These fire BEFORE/AFTER the animation, giving us precise timing
                        register_fullscreen_observer(ns_window, app_handle);
                    }
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                let app_handle = app.handle().clone();

                if let Some(window) = app.get_webview_window("main") {
                    let window_clone = window.clone();

                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::Resized(_) = event {
                            if let Ok(is_fullscreen) = window_clone.is_fullscreen() {
                                let _ = app_handle.emit("fullscreen-changed", is_fullscreen);
                            }
                        }
                    });
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
