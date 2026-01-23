use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
use cocoa::appkit::{NSWindow, NSWindowButton};

#[cfg(target_os = "macos")]
use cocoa::base::{id, nil};

#[cfg(target_os = "macos")]
use objc::declare::ClassDecl;

#[cfg(target_os = "macos")]
use objc::runtime::{Object, Sel};

#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};

/// Set the visibility of macOS traffic light buttons (close, minimize, zoom)
#[cfg(target_os = "macos")]
fn set_traffic_lights_visible(ns_window: id, visible: bool) {
    unsafe {
        let buttons = [
            NSWindowButton::NSWindowCloseButton,
            NSWindowButton::NSWindowMiniaturizeButton,
            NSWindowButton::NSWindowZoomButton,
        ];
        for button_type in buttons {
            let button: id = ns_window.standardWindowButton_(button_type);
            if button != nil {
                let _: () = msg_send![button, setHidden: !visible];
            }
        }
    }
}

#[cfg(target_os = "macos")]
struct FullscreenObserverContext {
    ns_window: id,
    app_handle: tauri::AppHandle,
}

#[cfg(target_os = "macos")]
static mut OBSERVER_CONTEXT: Option<Box<FullscreenObserverContext>> = None;

/// Callback for NSWindowWillExitFullScreenNotification - fires BEFORE the animation
#[cfg(target_os = "macos")]
extern "C" fn handle_will_exit_fullscreen(_this: &Object, _cmd: Sel, _notification: id) {
    unsafe {
        if let Some(ref ctx) = OBSERVER_CONTEXT {
            // Hide traffic lights BEFORE the animation starts
            set_traffic_lights_visible(ctx.ns_window, false);

            // Emit event to frontend to move button immediately
            let _ = ctx.app_handle.emit("fullscreen-changed", false);
        }
    }
}

/// Callback for NSWindowDidExitFullScreenNotification - fires AFTER the animation
#[cfg(target_os = "macos")]
extern "C" fn handle_did_exit_fullscreen(_this: &Object, _cmd: Sel, _notification: id) {
    unsafe {
        if let Some(ref ctx) = OBSERVER_CONTEXT {
            // Show traffic lights after animation completes + delay for toggle button animation (200ms)
            // Convert to usize for thread safety, then back to id
            let ns_window_ptr = ctx.ns_window as usize;
            dispatch::Queue::main().exec_after(
                std::time::Duration::from_millis(200),
                move || {
                    let ns_window = ns_window_ptr as id;
                    set_traffic_lights_visible(ns_window, true);
                },
            );
        }
    }
}

/// Callback for NSWindowWillEnterFullScreenNotification - fires BEFORE the animation
#[cfg(target_os = "macos")]
extern "C" fn handle_will_enter_fullscreen(_this: &Object, _cmd: Sel, _notification: id) {
    unsafe {
        if let Some(ref ctx) = OBSERVER_CONTEXT {
            // Notify frontend that fullscreen transition is starting
            // Frontend will show traffic light outlines during the animation
            let _ = ctx.app_handle.emit("fullscreen-transition-start", ());
        }
    }
}

/// Callback for NSWindowDidEnterFullScreenNotification - fires AFTER the animation
#[cfg(target_os = "macos")]
extern "C" fn handle_did_enter_fullscreen(_this: &Object, _cmd: Sel, _notification: id) {
    unsafe {
        if let Some(ref ctx) = OBSERVER_CONTEXT {
            // Emit event to frontend after macOS animation completes
            // This allows the CSS transition to run smoothly
            let _ = ctx.app_handle.emit("fullscreen-changed", true);
        }
    }
}

#[cfg(target_os = "macos")]
fn register_fullscreen_observer(ns_window: id, app_handle: tauri::AppHandle) {
    unsafe {
        // Store context for callbacks
        OBSERVER_CONTEXT = Some(Box::new(FullscreenObserverContext {
            ns_window,
            app_handle,
        }));

        // Create a custom class to receive notifications
        let superclass = class!(NSObject);
        let mut decl = ClassDecl::new("FullscreenObserver", superclass).unwrap();

        // Add methods for notification callbacks
        decl.add_method(
            sel!(windowWillExitFullScreen:),
            handle_will_exit_fullscreen as extern "C" fn(&Object, Sel, id),
        );
        decl.add_method(
            sel!(windowDidExitFullScreen:),
            handle_did_exit_fullscreen as extern "C" fn(&Object, Sel, id),
        );
        decl.add_method(
            sel!(windowWillEnterFullScreen:),
            handle_will_enter_fullscreen as extern "C" fn(&Object, Sel, id),
        );
        decl.add_method(
            sel!(windowDidEnterFullScreen:),
            handle_did_enter_fullscreen as extern "C" fn(&Object, Sel, id),
        );

        let observer_class = decl.register();
        let observer: id = msg_send![observer_class, new];

        // Get notification center
        let notification_center: id = msg_send![class!(NSNotificationCenter), defaultCenter];

        // Get notification name strings
        let will_exit_name: id = msg_send![class!(NSString), stringWithUTF8String: b"NSWindowWillExitFullScreenNotification\0".as_ptr()];
        let did_exit_name: id = msg_send![class!(NSString), stringWithUTF8String: b"NSWindowDidExitFullScreenNotification\0".as_ptr()];
        let will_enter_name: id = msg_send![class!(NSString), stringWithUTF8String: b"NSWindowWillEnterFullScreenNotification\0".as_ptr()];
        let did_enter_name: id = msg_send![class!(NSString), stringWithUTF8String: b"NSWindowDidEnterFullScreenNotification\0".as_ptr()];

        // Register observers
        let _: () = msg_send![notification_center,
            addObserver: observer
            selector: sel!(windowWillExitFullScreen:)
            name: will_exit_name
            object: ns_window
        ];

        let _: () = msg_send![notification_center,
            addObserver: observer
            selector: sel!(windowDidExitFullScreen:)
            name: did_exit_name
            object: ns_window
        ];

        let _: () = msg_send![notification_center,
            addObserver: observer
            selector: sel!(windowWillEnterFullScreen:)
            name: will_enter_name
            object: ns_window
        ];

        let _: () = msg_send![notification_center,
            addObserver: observer
            selector: sel!(windowDidEnterFullScreen:)
            name: did_enter_name
            object: ns_window
        ];
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let app_handle = app.handle().clone();

                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(ns_window_ptr) = window.ns_window() {
                        let ns_window = ns_window_ptr as id;

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
