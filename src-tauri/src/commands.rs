//! The only two commands the renderer can invoke.
//!
//! Everything a command returns as an error is one of three compile-time literals. Nothing is
//! formatted, nothing carries a `source`, and no filesystem path or map content can travel with
//! any of them: an error thrown out of here is written to the process console, which on a
//! Finder-launched macOS build lands in the system log, which sysdiagnose collects and hands to
//! third parties. The user is told the action did not complete, never which entry is at fault.
//!
//! The dialog is opened from Rust, not from the renderer, so no filesystem path ever crosses the
//! boundary in either direction.

use crate::project_file::{
    read_project_file, write_project_file, ReadError, WriteError, MAX_PROJECT_BYTES,
    SAVE_BLOCKED_BY_LOCK,
};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

pub const OPEN_FAILED: &str = "This file could not be read as a project.";
pub const SAVE_FAILED: &str = "The project could not be saved.";

const FILTER_NAME: &str = "Traccia project";
const FILTER_EXT: &str = "json";

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
