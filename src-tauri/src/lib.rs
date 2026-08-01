#![forbid(unsafe_code)]

//! App setup. The scaffold's `greet` command and its opener plugin are gone: the only
//! `#[tauri::command]`s this app will ever register are `open_project` and `save_project`,
//! which arrive with `commands.rs`.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
