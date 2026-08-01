//! A local crash line. Spec §7 forbids crash reporting, so nothing here is ever uploaded — this
//! exists only so an unhandled error does not vanish silently, and the user can find the file and
//! decide for themselves whether to share it.

use std::io::Write;
use std::path::Path;

/// A panic message can contain anything that was in scope. Truncating bounds how much of the map
/// a backtrace could carry into a file the user might later send to someone.
const MAX_MESSAGE: usize = 200;

/// The timestamp is a parameter, not a clock read, for the same reason `src/core` takes its
/// timestamps as parameters: it makes the behaviour testable exactly.
pub fn write_crash_line(dir: &Path, line: &str, stamp: &str) {
    let mut end = MAX_MESSAGE.min(line.len());
    while end > 0 && !line.is_char_boundary(end) {
        end -= 1;
    }
    let safe = &line[..end];
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("traccia.log"))
    else {
        // Called from a panic hook. A failure to log must not become a second failure.
        return;
    };
    let _ = writeln!(file, "{stamp} {safe}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_the_file_and_appends_a_line() {
        let dir = tempfile::tempdir().unwrap();
        write_crash_line(dir.path(), "boom", "2026-07-31T00:00:00Z");
        let text = std::fs::read_to_string(dir.path().join("traccia.log")).unwrap();
        assert!(text.contains("boom"));
        assert!(text.contains("2026-07-31T00:00:00Z"));
    }

    #[test]
    fn appends_rather_than_replacing() {
        let dir = tempfile::tempdir().unwrap();
        write_crash_line(dir.path(), "first", "t1");
        write_crash_line(dir.path(), "second", "t2");
        let text = std::fs::read_to_string(dir.path().join("traccia.log")).unwrap();
        assert!(text.contains("first"));
        assert!(text.contains("second"));
    }

    #[test]
    fn never_records_more_than_the_cap_so_a_backtrace_cannot_carry_the_map_in() {
        let dir = tempfile::tempdir().unwrap();
        write_crash_line(dir.path(), &"x".repeat(5000), "t");
        let text = std::fs::read_to_string(dir.path().join("traccia.log")).unwrap();
        assert!(text.len() < 400, "log line was {} bytes", text.len());
    }

    #[test]
    fn truncates_on_a_character_boundary_rather_than_panicking() {
        let dir = tempfile::tempdir().unwrap();
        write_crash_line(dir.path(), &"é".repeat(500), "t");
        assert!(std::fs::read_to_string(dir.path().join("traccia.log")).is_ok());
    }

    #[test]
    fn an_unwritable_directory_is_swallowed_not_propagated() {
        // This runs from a panic hook. A failure to log must never become a second failure.
        write_crash_line(Path::new("/definitely/not/a/directory"), "boom", "t");
    }
}
