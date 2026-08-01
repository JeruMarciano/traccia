#![forbid(unsafe_code)]

//! App setup. The scaffold's `greet` command and its opener plugin are gone: the only
//! `#[tauri::command]`s this app will ever register are `open_project` and `save_project`,
//! which arrive with `commands.rs`.

// `pub` because Task 3's stated interface — `Decision`, `DenyReason`, `decide` — is only an
// interface if it is reachable from the crate root. `proxy` is the only caller in this crate.
pub mod admission;
// `pub` for the same reason `admission` is: Task 5's stated interface is only an interface if it
// is reachable from the crate root. `commands` is the only caller in this crate.
pub mod project_file;
pub mod proxy;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
