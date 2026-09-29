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
