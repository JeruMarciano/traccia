//! Real-Chrome scans of local fixture pages: what the scanner reads from a
//! page, as current Chrome actually answers it — the behaviour `cdp.rs`'s
//! `FakeTransport` cannot prove. Every scan dials only 127.0.0.1 (see
//! `common`).

mod common;

use traccia_lib::cdp::{Phase, Purpose};

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

// --- Task 7 fix round ---

#[tokio::test]
async fn a_home_that_redirects_before_the_click_is_not_a_navigation() {
    let site = common::fixture_site_serving(vec![
        ("/", "302 /it/".into()),
        ("/it/", include_str!("fixtures/pages/text-banner.html").into()),
    ])
    .await;
    let out = common::scan(&site).await;
    let consent = serde_json::to_value(&out.consent).expect("json");
    assert_eq!(consent["clicked"], true, "{consent}");
    assert_eq!(consent["clickNavigated"], false, "{consent}");
}

#[tokio::test]
async fn a_centred_camel_case_cookiebot_dialog_is_a_consent_container() {
    let out = scan_home(include_str!("fixtures/pages/cookiebot-modal.html")).await;
    let consent = serde_json::to_value(&out.consent).expect("json");
    assert_eq!(consent["clicked"], true, "{consent}");
    assert_eq!(consent["rule"], "text", "{consent}");
    assert_eq!(consent["matchedText"], "allow all", "{consent}");
}

// --- Task 8: the page picker ---

#[tokio::test]
async fn a_contacts_page_linked_last_is_picked_and_an_offsite_redirect_is_dropped() {
    let form = "<!doctype html><form><input name=\"email\" type=\"email\"></form>";
    let site = common::fixture_site_serving(vec![
        ("/", include_str!("fixtures/pages/picker-home.html").into()),
        ("/contatti", form.into()),
        ("/esterno", "302 http://offsite-{port}.invalid/offsite-form".into()),
        ("/offsite-form", form.replace("email", "offsite_field")),
    ])
    .await;
    let out = common::scan(&site).await;
    let contacts = format!("http://{}/contatti", site.host);
    assert!(
        out.pages.iter().any(|p| p.page == contacts && p.purpose == Some(Purpose::Contacts)),
        "{:?}",
        out.pages
    );
    assert!(out.form_fields.iter().any(|f| f.page == contacts && f.name == "email"));
    assert!(out.pages.len() <= 12, "{:?}", out.pages);
    // The off-site page: no fields, no host, not a visited page.
    assert!(!out.form_fields.iter().any(|f| f.name == "offsite_field"), "{:?}", out.form_fields);
    let offsite = site.host.replace("scan-fixture-", "offsite-");
    assert!(!out.hosts.iter().any(|h| h.host == offsite), "{:?}", out.hosts);
    assert!(!out.pages.iter().any(|p| p.page.contains("esterno")), "{:?}", out.pages);
}

// --- Task 14: a page that did not load ---

/// A site whose home host the connector cannot reach: nothing listens on
/// loopback port 1, so the dial is refused.
fn unreachable_site() -> common::Site {
    common::Site {
        host: "scan-fixture-unreachable.invalid".into(),
        origin_port: 1,
        third_party_port: 1,
    }
}

#[tokio::test]
async fn a_home_that_cannot_be_reached_is_no_page_and_no_claim() {
    let site = unreachable_site();
    let out = common::scan(&site).await;
    assert_eq!(out.pages_visited, 0, "{out:?}");
    // Blank: "no-banner" would be a claim about a page nobody saw.
    assert_eq!(out.consent, Default::default(), "{:?}", out.consent);
    assert!(out.possible_gaps >= 1, "{out:?}");
    // Chrome's own error page reaches for Google hosts; none is the site's.
    assert!(out.hosts.iter().all(|h| h.host == site.host), "{:?}", out.hosts);
    assert!(out.form_fields.is_empty() && out.iframes.is_empty() && out.storage_keys.is_empty());
}

#[tokio::test]
async fn a_home_that_answers_404_itself_is_a_loaded_page() {
    // No page registered for `/`: the fixture server answers 404 on its own.
    let site = common::fixture_site_serving(vec![("/altro", String::new())]).await;
    let out = common::scan(&site).await;
    assert_eq!(out.pages_visited, 1, "{out:?}");
    assert_eq!(out.consent.reason, Some("no-banner"), "{:?}", out.consent);
}

// --- Task 9: probes and doors ---

#[tokio::test]
async fn iframes_on_two_pages_and_a_one_field_newsletter_form_are_captured() {
    let frame = "<iframe src=\"http://maps-fixture.invalid/maps/embed\"></iframe>";
    let home = format!(
        "<!doctype html><a href=\"/contatti\">Contatti</a>{frame}\
         <form action=\"http://sibforms-fixture.invalid/serve\"><input type=\"email\" name=\"EMAIL\"></form>\
         <a href=\"http://book-fixture.invalid/prenota\">Prenota</a>"
    );
    let site = common::fixture_site_serving(vec![
        ("/", home),
        ("/contatti", format!("<!doctype html>{frame}")),
    ])
    .await;
    let out = common::scan(&site).await;
    let maps_on: Vec<&str> = out
        .iframes
        .iter()
        .filter(|f| f.host == "maps-fixture.invalid" && f.segment == "maps")
        .map(|f| f.page.as_str())
        .collect();
    assert_eq!(maps_on.len(), 2, "{:?}", out.iframes);
    assert_ne!(maps_on[0], maps_on[1]);
    let email = out.form_fields.iter().find(|f| f.name == "EMAIL").expect("the newsletter field");
    assert_eq!((email.form, email.action_host.as_str()), (0, "sibforms-fixture.invalid"));
    assert!(
        out.offsite_links.iter().any(|l| l.host == "book-fixture.invalid" && l.purpose == Purpose::Booking),
        "{:?}",
        out.offsite_links
    );
}
