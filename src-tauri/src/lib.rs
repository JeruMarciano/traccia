#![forbid(unsafe_code)]

//! App setup. The scaffold's `greet` command and its opener plugin are gone: the only
//! `#[tauri::command]`s this app registers are `open_project`, `save_project`, `start_scan` and
//! `cancel_scan`.

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
pub mod scan;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // No proxy is started here, and the app-lifetime `ScanOrigins` that used to be built
        // here is gone. Each scan starts its own proxy, with its own origins and its own ledger,
        // because the ledger assertion is per-scan: a shared ledger would fail the second scan on
        // the first scan's hosts, and a per-scan origins `Arc` means an orphaned listener from an
        // earlier scan can never be re-armed by a later one. A proxy nothing routes through is
        // not a guard, it is dead weight — and it made the resting state ambiguous, because a
        // listener existing said nothing about whether anything was being watched.
        .manage(Arc::new(scan::ScanState::default()))
        .setup(move |app| {
            install_panic_hook(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::save_project,
            commands::start_scan,
            commands::cancel_scan
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
