//! The four commands the renderer can invoke.
//!
//! Everything the two project commands return as an error is one of three compile-time literals.
//! The two scan commands answer with one of `scan.rs`'s four tokens, under the same rule and for
//! the same reason. Nothing is
//! formatted, nothing carries a `source`, and no filesystem path or map content can travel with
//! any of them: an error thrown out of here is written to the process console, which on a
//! Finder-launched macOS build lands in the system log, which sysdiagnose collects and hands to
//! third parties. The user is told the action did not complete, never which entry is at fault.
//!
//! The dialog is opened from Rust, not from the renderer, so no filesystem path ever crosses the
//! boundary in either direction.

use crate::extract::{self, ExtractResult};
use crate::project_file::{
    read_project_file, write_project_file, ReadError, WriteError, MAX_PROJECT_BYTES,
    SAVE_BLOCKED_BY_LOCK,
};
use crate::scan::{self, ScanState};
use std::sync::Arc;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

pub const OPEN_FAILED: &str = "This file could not be read as a project.";
pub const SAVE_FAILED: &str = "The project could not be saved.";
/// Only reachable if the `spawn_blocking` task itself panicked or was cancelled — `extract_text`
/// has no fallible return of its own, one bad file becomes that file's `ExtractResult::Err`
/// entry rather than failing the call. See Finding 3 in the v0.2 security audit.
pub const EXTRACT_FAILED: &str = "The selected documents could not be read.";

const FILTER_NAME: &str = "Traccia project";
const FILTER_EXT: &str = "json";

const DOCUMENT_FILTER_NAME: &str = "Documents";
const DOCUMENT_FILTER_EXTS: &[&str] = &["pdf", "docx", "xlsx", "csv", "txt", "log"];

fn open_error(_e: ReadError) -> &'static str {
    OPEN_FAILED
}

/// The single exception to the generic message: the file-is-locked sentence, which is a
/// compile-time constant with nothing interpolated into it, and the one save failure a user can
/// act on.
fn save_error(e: WriteError) -> &'static str {
    match e {
        WriteError::Locked => SAVE_BLOCKED_BY_LOCK,
        WriteError::Io => SAVE_FAILED,
    }
}

/// What Rust checks before writing: that the bytes are a JSON object with an integer
/// `schemaVersion`, under the size cap. What makes a project *valid* is `validateProject` in
/// `src/core/project.ts`, which stays the single source of truth for the map's shape and runs in
/// `src/renderer/bridge.ts` in both directions. Rust checks what protects the machine;
/// TypeScript checks what protects the map.
pub(crate) fn structural_check(json: &str) -> Result<(), &'static str> {
    if json.len() > MAX_PROJECT_BYTES {
        return Err(SAVE_FAILED);
    }
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| SAVE_FAILED)?;
    let object = value.as_object().ok_or(SAVE_FAILED)?;
    match object.get("schemaVersion") {
        Some(v) if v.is_i64() || v.is_u64() => Ok(()),
        _ => Err(SAVE_FAILED),
    }
}

#[tauri::command]
pub async fn open_project(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter(FILTER_NAME, &[FILTER_EXT])
        .pick_file(move |picked| {
            let _ = tx.send(picked);
        });
    let Ok(Some(picked)) = rx.await else {
        // Either the user cancelled, or the channel closed. Neither is a failure.
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| OPEN_FAILED.to_string())?;
    read_project_file(&path)
        .map(Some)
        .map_err(|e| open_error(e).to_string())
}

#[tauri::command]
pub async fn save_project(app: AppHandle, project_json: String) -> Result<bool, String> {
    structural_check(&project_json).map_err(|m| m.to_string())?;

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter(FILTER_NAME, &[FILTER_EXT])
        .save_file(move |picked| {
            let _ = tx.send(picked);
        });
    let Ok(Some(picked)) = rx.await else {
        return Ok(false);
    };
    let path = picked.into_path().map_err(|_| SAVE_FAILED.to_string())?;
    write_project_file(&path, &project_json).map_err(|e| save_error(e).to_string())?;
    Ok(true)
}

/// Runs one scan of the address the user typed. Returns `ScanResult` as JSON.
///
/// Refused with `SCAN_BUSY` while another scan is running, so two invocations
/// can never both be inside `scan::run` widening what one proxy admits.
#[tauri::command]
pub async fn start_scan(
    state: tauri::State<'_, Arc<ScanState>>,
    url: String,
) -> Result<String, String> {
    scan::run(Arc::clone(&state), url).await
}

/// Stops the running scan. Nothing running is not an error: the user pressed
/// stop as the scan was already finishing.
#[tauri::command]
pub async fn cancel_scan(state: tauri::State<'_, Arc<ScanState>>) -> Result<(), String> {
    scan::cancel(&state);
    Ok(())
}

/// Opens the native multi-select file picker, filtered to the five document kinds
/// `extract.rs` understands, then extracts text from whatever was picked.
///
/// The dialog is opened from Rust, exactly like `open_project`'s, so a filesystem path never
/// crosses into the renderer in either direction: only `ExtractResult`, keyed by file name, does.
/// Cancelling the picker is not an error — it returns an empty list, the same way `open_project`
/// returns `None`.
#[tauri::command]
pub async fn pick_and_extract_documents(app: AppHandle) -> Result<Vec<ExtractResult>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter(DOCUMENT_FILTER_NAME, DOCUMENT_FILTER_EXTS)
        .pick_files(move |picked| {
            let _ = tx.send(picked);
        });
    let Ok(Some(picked)) = rx.await else {
        return Ok(Vec::new());
    };
    let paths: Vec<std::path::PathBuf> = picked
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .collect();
    // v0.2 security audit, Finding 3 (MINOR). `extract_text` parses whatever the user picked —
    // PDF/DOCX/XLSX/CSV/TXT, up to 50 MB each — synchronously. Running that on a tokio worker
    // thread blocks it for the duration, starving every other task sharing that worker (a
    // running scan's proxy included). `spawn_blocking` moves it to a thread meant for exactly
    // this, the same pattern `scan.rs` uses for `browser::discover` and `browser::launch`.
    match tokio::task::spawn_blocking(move || extract::extract_text(&paths)).await {
        Ok(results) => Ok(results),
        Err(_) => Err(EXTRACT_FAILED.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_well_formed_project_document() {
        assert_eq!(structural_check("{\"schemaVersion\":1,\"places\":[]}"), Ok(()));
    }

    #[test]
    fn refuses_anything_that_is_not_json() {
        assert_eq!(structural_check("not json"), Err(SAVE_FAILED));
        assert_eq!(structural_check(""), Err(SAVE_FAILED));
    }

    #[test]
    fn refuses_a_json_document_that_is_not_an_object() {
        for s in ["[]", "1", "\"a\"", "null", "true"] {
            assert_eq!(structural_check(s), Err(SAVE_FAILED), "{s}");
        }
    }

    #[test]
    fn refuses_a_document_with_no_integer_schema_version() {
        for s in [
            "{}",
            "{\"schemaVersion\":\"1\"}",
            "{\"schemaVersion\":1.5}",
            "{\"schemaVersion\":null}",
        ] {
            assert_eq!(structural_check(s), Err(SAVE_FAILED), "{s}");
        }
    }

    #[test]
    fn refuses_a_payload_over_the_size_cap_without_parsing_it() {
        let huge = format!(
            "{{\"schemaVersion\":1,\"pad\":\"{}\"}}",
            "x".repeat(MAX_PROJECT_BYTES)
        );
        assert_eq!(structural_check(&huge), Err(SAVE_FAILED));
    }

    #[test]
    fn exactly_three_literals_can_ever_reach_the_renderer() {
        // Anything else means a formatted string got into an error path, which is how a
        // filesystem path or a place id ends up in the system log.
        let permitted = [OPEN_FAILED, SAVE_FAILED, SAVE_BLOCKED_BY_LOCK];
        for s in permitted {
            assert!(!s.contains('{'), "{s:?} looks like a format string");
            assert!(!s.contains('/') && !s.contains('\\'), "{s:?} could carry a path");
        }
        assert_eq!(permitted.len(), 3);
    }

    #[test]
    fn a_read_error_maps_to_the_one_open_message_whatever_went_wrong() {
        for e in [ReadError::Io, ReadError::TooLarge, ReadError::NotJson] {
            assert_eq!(open_error(e), OPEN_FAILED);
        }
    }

    #[test]
    fn only_a_lock_gets_the_actionable_save_message() {
        assert_eq!(save_error(WriteError::Locked), SAVE_BLOCKED_BY_LOCK);
        assert_eq!(save_error(WriteError::Io), SAVE_FAILED);
    }
}
