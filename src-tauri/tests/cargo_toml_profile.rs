//! v0.2 security audit, Finding 1 (CRITICAL). `catch_unwind` in `extract.rs` and `Drop for
//! Launched` in `browser.rs` are both only real guarantees if the release profile actually
//! unwinds. A test suite alone cannot pin that — Cargo's *test* profile unwinds regardless of
//! what `[profile.release]` says, which is exactly how the false assurance this finding
//! describes happened in the first place: `extract.rs`'s panic-recovery test passed while the
//! shipped binary's `panic = "abort"` made `catch_unwind` inert. So this test reads
//! `Cargo.toml` itself, the one place both promises actually come from, and fails if the
//! release profile ever sets `panic = "abort"` again.

use std::path::Path;

/// The text of the `[profile.release]` table only — from its header up to (not including) the
/// next `[...]` table header, or end of file. No TOML crate is pulled in for this: the shape
/// being checked is narrow enough that a section-scoped substring search is unambiguous, and it
/// keeps this guarantee free of a parser dependency of its own.
fn release_profile_section(cargo_toml: &str) -> &str {
    let start = cargo_toml
        .find("[profile.release]")
        .expect("Cargo.toml has no [profile.release] table");
    let after_header = &cargo_toml[start..];
    let body_start = after_header
        .find('\n')
        .map(|i| i + 1)
        .unwrap_or(after_header.len());
    let body = &after_header[body_start..];
    let end = body
        .lines()
        .scan(0usize, |offset, line| {
            let this_offset = *offset;
            *offset += line.len() + 1; // + the newline this iterator strips
            Some((this_offset, line))
        })
        .find(|(_, line)| line.trim_start().starts_with('['))
        .map(|(offset, _)| offset)
        .unwrap_or(body.len());
    &body[..end]
}

#[test]
fn the_release_profile_never_sets_panic_to_abort() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let cargo_toml_path = Path::new(manifest_dir).join("Cargo.toml");
    let contents = std::fs::read_to_string(&cargo_toml_path)
        .unwrap_or_else(|e| panic!("could not read {}: {e}", cargo_toml_path.display()));

    let release_section = release_profile_section(&contents);

    assert!(
        !release_section.contains("panic = \"abort\""),
        "[profile.release] panic = \"abort\" makes extract.rs's catch_unwind inert (a hostile \
         document's panic kills the whole app instead of being caught) and stops \
         browser::Launched's Drop from running on panic (orphaning Chrome and leaving a \
         scanned site's cookies on disk) — see the comment above [profile.release] in \
         Cargo.toml and browser.rs's `Drop for Launched`."
    );
}

#[test]
fn release_profile_section_stops_at_the_next_table_header() {
    let toml = "[profile.release]\nopt-level = \"z\"\npanic = \"unwind\"\n\n[profile.dev]\npanic = \"abort\"\n";
    let section = release_profile_section(toml);
    assert!(section.contains("panic = \"unwind\""));
    assert!(!section.contains("panic = \"abort\""));
}
