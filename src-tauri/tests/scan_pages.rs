//! Real-Chrome scans of local fixture pages: what the scanner reads from a
//! page, as current Chrome actually answers it — the behaviour `cdp.rs`'s
//! `FakeTransport` cannot prove. Every scan dials only 127.0.0.1 (see
//! `common`).

mod common;

use traccia_lib::cdp::Phase;

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
    // Its accept button is visible, so since Task 6 the rule clicks it.
    assert!(out.consent.clicked, "{:?}", out.consent);
    assert_eq!(out.consent.reason, None);
}

#[tokio::test]
async fn an_iubenda_banner_is_accepted_by_its_rule_and_what_follows_is_after() {
    let site = common::fixture_site_serving(vec![(
        "/",
        include_str!("fixtures/pages/iubenda-accept.html").into(),
    )])
    .await;
    let out = common::scan(&site).await;
    let consent = serde_json::to_value(&out.consent).expect("json");
    assert_eq!(consent["clicked"], true, "{consent}");
    assert_eq!(consent["rule"], "cmp", "{consent}");
    assert_eq!(consent["ruleName"], "iubenda", "{consent}");
    let phase = |host: &str| out.hosts.iter().find(|h| h.host == host).map(|h| h.phase);
    let after_host = site.host.replace("scan-fixture-", "after-");
    assert_eq!(phase(&after_host), Some(Phase::After), "{:?}", out.hosts);
    assert_eq!(phase(&site.host), Some(Phase::Before), "{:?}", out.hosts);
    let cookie = out.cookies.iter().find(|c| c.name == "traccia_consent");
    assert_eq!(cookie.and_then(|c| c.phase), Some(Phase::After), "{:?}", out.cookies);
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

// --- Task 7: the text click ---

#[tokio::test]
async fn a_weak_label_outside_a_consent_container_is_never_clicked() {
    let out = scan_home(include_str!("fixtures/pages/blog-continua.html")).await;
    assert!(!out.consent.clicked, "{:?}", out.consent);
    assert_eq!(out.consent.reason, Some("no-banner"));
}

#[tokio::test]
async fn a_label_inside_a_cookie_notice_is_clicked_and_recorded() {
    let out = scan_home(include_str!("fixtures/pages/text-banner.html")).await;
    let consent = serde_json::to_value(&out.consent).expect("json");
    assert_eq!(consent["clicked"], true, "{consent}");
    assert_eq!(consent["rule"], "text", "{consent}");
    assert_eq!(consent["matchedText"], "ho capito", "{consent}");
    assert_eq!(consent["clickNavigated"], false, "{consent}");
    let cookie = out.cookies.iter().find(|c| c.name == "ok");
    assert_eq!(cookie.and_then(|c| c.phase), Some(Phase::After), "{:?}", out.cookies);
}

#[tokio::test]
async fn a_click_that_navigates_is_flagged_and_the_walk_goes_on_from_home() {
    let site = common::fixture_site_serving(vec![
        ("/", include_str!("fixtures/pages/text-banner-link.html").into()),
        ("/grazie", "<!doctype html><p>Grazie</p>".into()),
        (
            "/a",
            "<!doctype html><script>document.cookie='seen_a=1; max-age=3600; path=/'</script>"
                .into(),
        ),
    ])
    .await;
    let out = common::scan(&site).await;
    let consent = serde_json::to_value(&out.consent).expect("json");
    assert_eq!(consent["clicked"], true, "{consent}");
    assert_eq!(consent["matchedText"], "accetta tutti", "{consent}");
    assert_eq!(consent["clickNavigated"], true, "{consent}");
    // `/a` is linked only from the home page, not from `/grazie`.
    assert!(out.cookies.iter().any(|c| c.name == "seen_a"), "{:?}", out.cookies);
}
