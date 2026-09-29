//! Real-Chrome scans of local fixture pages: what the scanner reads from a
//! page, as current Chrome actually answers it — the behaviour `cdp.rs`'s
//! `FakeTransport` cannot prove. Every scan dials only 127.0.0.1 (see
//! `common`).

mod common;

#[tokio::test]
async fn a_cookie_the_page_sets_is_captured() {
    let site = common::fixture_site_serving(vec![(
        "/",
        "<!doctype html><script>document.cookie='traccia_probe=1; max-age=3600; path=/'</script>"
            .into(),
    )])
    .await;
    let out = common::scan(&site).await;
    assert!(
        out.cookies.iter().any(|c| c.name == "traccia_probe"),
        "{:?}",
        out.cookies
    );
}

/// Scans a home page read from `tests/fixtures/pages/`.
async fn scan_home(html: &str) -> traccia_lib::scan::ScanOutput {
    let site = common::fixture_site_serving(vec![("/", html.into())]).await;
    common::scan(&site).await
}

#[tokio::test]
async fn an_iubenda_banner_is_detected_by_its_rule_name() {
    let out = scan_home(include_str!("fixtures/pages/iubenda-banner.html")).await;
    assert_eq!(out.consent.cmp.as_deref(), Some("iubenda"), "{:?}", out.consent);
    assert!(!out.consent.clicked);
    assert_eq!(out.consent.reason, Some("no-button"));
}

#[tokio::test]
async fn an_iubenda_privacy_badge_alone_is_no_cmp() {
    let out = scan_home(include_str!("fixtures/pages/iubenda-badge-only.html")).await;
    assert_eq!(out.consent.cmp, None, "{:?}", out.consent);
    assert_eq!(out.consent.reason, Some("no-banner"));
}

#[tokio::test]
async fn a_page_cannot_forge_a_consent_message() {
    let out = scan_home(include_str!("fixtures/pages/forged-binding.html")).await;
    assert_eq!(out.consent.cmp, None, "{:?}", out.consent);
}
