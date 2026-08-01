//! Reading and writing the one file this application owns.
//!
//! The project file is the complete map of an organisation's personal-data flows, so three
//! properties matter more than convenience: a save is never half-written, a save never widens
//! who can read the file, and no error leaving this module names a path.

use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// The one save failure a user can do something about. A fixed sentence: no filesystem path,
/// nothing out of the map, nothing interpolated. That is what lets `commands.rs` pass it through
/// to the renderer instead of collapsing it into the generic message. `src/renderer/strings.ts`
/// holds the identical wording, and `tests/bridge/errorStrings.test.ts` pins the two together
/// across the language boundary.
pub const SAVE_BLOCKED_BY_LOCK: &str =
    "The project could not be saved because another program is holding the file open. Close it and try again.";

/// Hundreds of nodes, not millions (spec §11.1). A file larger than this is not a project, and
/// refusing it is cheaper and safer than loading it to find out.
pub const MAX_PROJECT_BYTES: usize = 64 * 1024 * 1024;

/// In the absence of any pre-existing permissions to carry forward, default to owner-only rather
/// than the platform default, so a save never leaves the map more widely readable than the user
/// would reasonably expect on a shared machine.
const DEFAULT_FILE_MODE: u32 = 0o600;

const RETRY_DELAYS: [Duration; 3] = [
    Duration::from_millis(50),
    Duration::from_millis(150),
    Duration::from_millis(400),
];

/// Field-less on purpose. An error that could carry detail would eventually carry a path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadError {
    Io,
    TooLarge,
    NotJson,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteError {
    Io,
    Locked,
}

pub fn read_project_file(path: &Path) -> Result<String, ReadError> {
    let meta = std::fs::metadata(path).map_err(|_| ReadError::Io)?;
    if meta.len() > MAX_PROJECT_BYTES as u64 {
        return Err(ReadError::TooLarge);
    }
    let mut file = std::fs::File::open(path).map_err(|_| ReadError::Io)?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).map_err(|_| ReadError::Io)?;
    // Structural check only. What makes a project *valid* is `validateProject` in `src/core`,
    // which is the single source of truth for the map's shape and stays that way — Rust checks
    // what protects the machine, TypeScript checks what protects the map. See Task 7.
    serde_json::from_str::<serde_json::Value>(&contents).map_err(|_| ReadError::NotJson)?;
    Ok(contents)
}

/// Unique per call: target basename, pid, a monotonic counter, and nanos since the epoch. Two
/// concurrent writes into the same directory can never share a temp path, so neither one's staged
/// data can be renamed away by the other and the failure-path cleanup can never delete the
/// other's file. The Electron version bought this with `crypto.randomUUID`; this buys it with no
/// crate.
fn temp_path_for(path: &Path) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let base = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    dir.join(format!(".{base}.{}.{n}.{nanos}.tmp", std::process::id()))
}

/// `rename` overwrites on both platforms, but on Windows it fails transiently when antivirus or
/// another program holds the target open (spec §8.1). Retry rather than surfacing an error nobody
/// can act on.
///
/// The rename is a parameter so this loop is testable on any platform. The Electron version's
/// equivalent had no coverage at all, which is the gap this closes.
pub(crate) fn rename_with_retry<F>(mut rename: F, delays: &[Duration]) -> Result<(), WriteError>
where
    F: FnMut() -> std::io::Result<()>,
{
    match rename() {
        Ok(()) => return Ok(()),
        Err(e) if !is_transient_lock(&e) => return Err(WriteError::Io),
        Err(_) => {}
    }
    for delay in delays {
        if !delay.is_zero() {
            std::thread::sleep(*delay);
        }
        match rename() {
            Ok(()) => return Ok(()),
            Err(e) if !is_transient_lock(&e) => return Err(WriteError::Io),
            Err(_) => {}
        }
    }
    Err(WriteError::Locked)
}

fn is_transient_lock(e: &std::io::Error) -> bool {
    matches!(
        e.kind(),
        ErrorKind::PermissionDenied | ErrorKind::ResourceBusy | ErrorKind::WouldBlock
    )
}

#[cfg(unix)]
fn existing_mode(path: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .ok()
        .map(|m| m.permissions().mode() & 0o777)
}

#[cfg(not(unix))]
fn existing_mode(_path: &Path) -> Option<u32> {
    None
}

#[cfg(unix)]
fn create_with_mode(path: &Path, mode: u32) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(path)
}

#[cfg(not(unix))]
fn create_with_mode(path: &Path, _mode: u32) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
}

/// Best-effort fsync of the containing directory, so the rename's metadata is flushed and not
/// only the file's data blocks. Windows cannot open a directory this way, so a failure here is
/// swallowed: this is hardening on top of the per-file sync below, not the mechanism that
/// guarantees a save is never truncated.
fn fsync_dir(dir: &Path) {
    if let Ok(handle) = std::fs::File::open(dir) {
        let _ = handle.sync_all();
    }
}

pub fn write_project_file(path: &Path, contents: &str) -> Result<(), WriteError> {
    let tmp = temp_path_for(path);
    // Carry forward the target's existing permissions instead of letting the rename silently
    // widen them to whatever mode the temp file was created with. New files are owner-only.
    let mode = existing_mode(path).unwrap_or(DEFAULT_FILE_MODE);

    let staged = (|| -> std::io::Result<()> {
        let mut file = create_with_mode(&tmp, mode)?;
        file.write_all(contents.as_bytes())?;
        // Flush before the rename. Rename is atomic against a concurrent reader and against a
        // process crash, but on power loss the directory-entry update can reach disk before the
        // data blocks do, leaving the target pointing at a truncated file — a half-written map.
        file.sync_all()?;
        Ok(())
    })();

    if staged.is_err() {
        let _ = std::fs::remove_file(&tmp);
        return Err(WriteError::Io);
    }

    match rename_with_retry(|| std::fs::rename(&tmp, path), &RETRY_DELAYS) {
        Ok(()) => {
            if let Some(dir) = path.parent() {
                fsync_dir(dir);
            }
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::io::{Error, ErrorKind};

    // ---- the retry loop, which had no coverage at all in the Electron version ----

    fn err(kind: ErrorKind) -> std::io::Result<()> {
        Err(Error::new(kind, ""))
    }

    #[test]
    fn a_rename_that_succeeds_first_time_is_not_retried() {
        let calls = Cell::new(0);
        let r = rename_with_retry(
            || {
                calls.set(calls.get() + 1);
                Ok(())
            },
            &[Duration::ZERO; 3],
        );
        assert_eq!(r, Ok(()));
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn a_transient_windows_lock_is_retried_and_then_succeeds() {
        // The exact scenario spec §8.1 describes: antivirus holds the target open for a moment.
        let calls = Cell::new(0);
        let r = rename_with_retry(
            || {
                calls.set(calls.get() + 1);
                if calls.get() < 3 {
                    err(ErrorKind::PermissionDenied)
                } else {
                    Ok(())
                }
            },
            &[Duration::ZERO; 3],
        );
        assert_eq!(r, Ok(()));
        assert_eq!(calls.get(), 3);
    }

    #[test]
    fn every_transient_code_the_electron_version_retried_is_retried_here() {
        for kind in [
            ErrorKind::PermissionDenied,
            ErrorKind::ResourceBusy,
            ErrorKind::WouldBlock,
        ] {
            let calls = Cell::new(0);
            let _ = rename_with_retry(
                || {
                    calls.set(calls.get() + 1);
                    err(kind)
                },
                &[Duration::ZERO; 3],
            );
            assert_eq!(calls.get(), 4, "{kind:?} was not retried the full schedule");
        }
    }

    #[test]
    fn a_lock_that_never_clears_reports_the_one_message_the_user_can_act_on() {
        let r = rename_with_retry(|| err(ErrorKind::PermissionDenied), &[Duration::ZERO; 3]);
        assert_eq!(r, Err(WriteError::Locked));
    }

    #[test]
    fn a_non_transient_failure_gives_up_immediately() {
        let calls = Cell::new(0);
        let r = rename_with_retry(
            || {
                calls.set(calls.get() + 1);
                err(ErrorKind::NotFound)
            },
            &[Duration::ZERO; 3],
        );
        assert_eq!(r, Err(WriteError::Io));
        assert_eq!(
            calls.get(),
            1,
            "a missing directory is not something waiting will fix"
        );
    }

    // ---- the write itself ----

    #[test]
    fn writes_and_reads_back_the_exact_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p.json");
        let contents = "{\n  \"schemaVersion\": 1\n}";
        write_project_file(&path, contents).unwrap();
        assert_eq!(read_project_file(&path).unwrap(), contents);
    }

    #[test]
    fn overwrites_an_existing_file_without_leaving_a_temp_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p.json");
        write_project_file(&path, "{\"schemaVersion\":1}").unwrap();
        write_project_file(&path, "{\"schemaVersion\":1,\"name\":\"x\"}").unwrap();
        let leftovers: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert_eq!(leftovers, Vec::<String>::new());
    }

    #[test]
    fn a_failed_write_leaves_no_temp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("no-such-dir").join("p.json");
        assert!(write_project_file(&path, "{}").is_err());
        assert!(!dir.path().join("no-such-dir").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_new_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p.json");
        write_project_file(&path, "{}").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            mode, 0o600,
            "the map must not be readable by others on a shared machine"
        );
    }

    #[cfg(unix)]
    #[test]
    fn an_existing_files_permissions_are_carried_forward_not_widened() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p.json");
        write_project_file(&path, "{}").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
        write_project_file(&path, "{\"a\":1}").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o640);
    }

    #[test]
    fn two_concurrent_writes_cannot_share_a_temp_path() {
        let dir = tempfile::tempdir().unwrap();
        let a = temp_path_for(&dir.path().join("p.json"));
        let b = temp_path_for(&dir.path().join("p.json"));
        assert_ne!(a, b);
    }

    // ---- reading ----

    #[test]
    fn refuses_a_file_that_is_not_json_without_saying_which_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p.json");
        std::fs::write(&path, "not json at all").unwrap();
        assert_eq!(read_project_file(&path), Err(ReadError::NotJson));
    }

    #[test]
    fn refuses_a_file_larger_than_the_cap_rather_than_loading_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p.json");
        std::fs::write(&path, vec![b'x'; MAX_PROJECT_BYTES + 1]).unwrap();
        assert_eq!(read_project_file(&path), Err(ReadError::TooLarge));
    }

    #[test]
    fn no_error_variant_can_carry_a_path_or_a_message() {
        // The variants are field-less by construction. This test exists so that adding a field
        // later — the natural thing to do while debugging — fails here rather than in production,
        // where it would put a filesystem path into the system log.
        assert_eq!(std::mem::size_of::<ReadError>(), 1);
        assert_eq!(std::mem::size_of::<WriteError>(), 1);
    }
}
