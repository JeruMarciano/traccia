//! Finding a Chromium-family browser already installed on the machine.
//!
//! Chrome first, then Edge. Edge ships with every Windows 10/11 install, so it
//! is the guaranteed hit that makes Windows work at all; Chrome covers macOS
//! and most Windows machines. Brave is deliberately absent: its built-in
//! blocker removes trackers before Traccia can observe them, so a Brave scan
//! reports a clean site that is not clean — a wrong answer, and the dangerous
//! direction for this tool.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Browser {
    Chrome,
    Edge,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub browser: Browser,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiscoveryError {
    /// Carries every path that was looked at, so the message can name them.
    NoneFound { searched: Vec<PathBuf> },
}

#[cfg(target_os = "macos")]
pub fn candidate_paths() -> Vec<(Browser, PathBuf)> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut out = vec![
        (
            Browser::Chrome,
            PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ),
    ];
    if let Some(h) = home.as_ref() {
        out.push((
            Browser::Chrome,
            h.join("Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ));
    }
    out.push((
        Browser::Edge,
        PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    ));
    if let Some(h) = home.as_ref() {
        out.push((
            Browser::Edge,
            h.join("Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
        ));
    }
    out
}

#[cfg(target_os = "windows")]
pub fn candidate_paths() -> Vec<(Browser, PathBuf)> {
    let mut out = Vec::new();
    for var in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var).map(PathBuf::from) {
            out.push((
                Browser::Chrome,
                base.join(r"Google\Chrome\Application\chrome.exe"),
            ));
        }
    }
    for var in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var).map(PathBuf::from) {
            out.push((
                Browser::Edge,
                base.join(r"Microsoft\Edge\Application\msedge.exe"),
            ));
        }
    }
    out
}

pub fn discover() -> Result<Found, DiscoveryError> {
    discover_in(&candidate_paths())
}

/// Split out so tests can drive it with paths they control. Never resolves a
/// name and never executes anything — it only asks whether a file is there.
fn discover_in(candidates: &[(Browser, PathBuf)]) -> Result<Found, DiscoveryError> {
    for (browser, path) in candidates {
        if is_executable_file(path) {
            return Ok(Found {
                browser: *browser,
                path: path.clone(),
            });
        }
    }
    Err(DiscoveryError::NoneFound {
        searched: candidate_paths().iter().map(|(_, p)| p.clone()).collect(),
    })
}

fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn searches_chrome_before_edge() {
        let paths = candidate_paths();
        let first_chrome = paths.iter().position(|(b, _)| matches!(b, Browser::Chrome));
        let first_edge = paths.iter().position(|(b, _)| matches!(b, Browser::Edge));
        assert!(first_chrome.is_some(), "no Chrome candidate on this platform");
        assert!(first_edge.is_some(), "no Edge candidate on this platform");
        assert!(first_chrome < first_edge);
    }

    #[test]
    fn offers_at_least_one_absolute_candidate_per_browser() {
        for (_, p) in candidate_paths() {
            assert!(p.is_absolute(), "candidate is not absolute: {}", p.display());
        }
    }

    #[test]
    fn names_every_path_it_searched_when_nothing_is_found() {
        // The failure a user actually hits is "I have a browser and it says I
        // don't". A bare "no browser found" is unactionable; the list is what
        // lets them see it looked in the wrong place.
        let err = discover_in(&[]);
        match err {
            Err(DiscoveryError::NoneFound { searched }) => {
                assert_eq!(searched.len(), candidate_paths().len());
                assert!(!searched.is_empty());
            }
            Ok(_) => panic!("found a browser among no candidates"),
        }
    }

    #[test]
    fn returns_the_first_candidate_that_exists() {
        let dir = tempfile::tempdir().expect("tempdir");
        let second = dir.path().join("second");
        std::fs::write(&second, b"x").expect("write");
        let missing = dir.path().join("first");
        let found = discover_in(&[
            (Browser::Chrome, missing),
            (Browser::Edge, second.clone()),
        ])
        .expect("should find the second");
        assert_eq!(found.path, second);
        assert!(matches!(found.browser, Browser::Edge));
    }

    #[test]
    fn never_panics_on_a_candidate_list_full_of_nonsense() {
        for bad in ["", " ", "\0not-a-path", "relative/path"] {
            let _ = discover_in(&[(Browser::Chrome, PathBuf::from(bad))]);
        }
    }
}
