#![forbid(unsafe_code)]

//! App setup. The scaffold's `greet` command and its opener plugin are gone: the only
//! `#[tauri::command]`s this app registers are `open_project` and `save_project`.

// `pub` because Task 3's stated interface — `Decision`, `DenyReason`, `decide` — is only an
// interface if it is reachable from the crate root. `proxy` is the only caller in this crate.
pub mod admission;
pub mod browser;
pub mod cdp;
pub mod commands;
pub mod log;
// `pub` for the same reason `admission` is: Task 5's stated interface is only an interface if it
// is reachable from the crate root. `commands` is the only caller in this crate.
pub mod project_file;
pub mod proxy;

use std::sync::{Arc, Mutex};

/// Populated only while a scan is running. Empty for the whole of this plan — the proxy denies
/// everything, which is the correct resting state. Phase 2 fills it from the URL the user typed.
type ScanOrigins = Arc<Mutex<Vec<String>>>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let scan_origins: ScanOrigins = Arc::new(Mutex::new(Vec::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            install_panic_hook(app.handle().clone());
            let origins = Arc::clone(&scan_origins);
            tauri::async_runtime::spawn(async move {
                // The guard is started before anything can use it, and denies everything until a
                // scan sets an origin. If it cannot bind, the app still runs: nothing is routed
                // through it during this plan, and Phase 2 must refuse to start a scan when the
                // handle is absent rather than falling back to a direct connection.
                let _ = proxy::start(origins, proxy::real_connector()).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::save_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// §7 forbids crash reporting: nothing is ever uploaded. This writes a local line the user can
/// find and choose to share, so an unhandled panic does not simply vanish.
fn install_panic_hook(app: tauri::AppHandle) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Ok(dir) = tauri::Manager::path(&app).app_log_dir() {
            let _ = std::fs::create_dir_all(&dir);
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs().to_string())
                .unwrap_or_default();
            // The payload is truncated inside write_crash_line; the location it names is a source
            // path in this repository, not anything out of the user's map.
            log::write_crash_line(&dir, &format!("panic: {info}"), &stamp);
        }
        previous(info);
    }));
}
