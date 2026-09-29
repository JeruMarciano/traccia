//! The loopback fixture site shared by the integration tests that scan with a
//! real local Chrome (`egress.rs`, `scan_pages.rs`). Nothing here performs
//! name resolution or dials anything but 127.0.0.1 — see `egress.rs`'s module
//! comment for why the connector is the one seam substituted.

// Each test binary compiles this module on its own and uses a different subset.
#![allow(dead_code)]

use std::net::SocketAddr;
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use traccia_lib::proxy;
use traccia_lib::scan::{self, ScanOutput, ScanState, Target};

/// The page every `fixture_site()` serves. Three off-site hosts by IP literal
/// — never resolved, never dialled, and `admission::decide` denies an IP
/// literal unconditionally (`DenyReason::IpLiteral`) before any connector sees
/// it — which is what proves the third assertion in `egress.rs`'s
/// `a_scan_contacts_the_target_and_nothing_else` is testing something real
/// rather than an empty ledger nobody ever tried to fill.
pub const FIXTURE_HTML: &str = concat!(
    "<!doctype html><html><body>",
    "<img src=\"http://192.0.2.10/pixel.gif\">",
    "<script src=\"http://198.51.100.20/track.js\"></script>",
    "<link rel=\"stylesheet\" href=\"http://203.0.113.30/style.css\">",
    "</body></html>",
);

/// A loopback HTTP server standing in for a scanned website, plus the
/// scan-target host the test suite tells `scan.rs` to open. The host is a
/// plain, dotted, non-IP string under `.invalid` so it passes every check
/// `admission::vet_host` and `scan::Target` construction would apply to a
/// real one; it is never resolved, because the connector below recognises it
/// as a string and dials the loopback listener directly.
pub struct Site {
    pub host: String,
    pub origin_port: u16,
}

impl Site {
    pub fn target(&self) -> Target {
        Target {
            url: format!("http://{}/", self.host),
            host: self.host.clone(),
            origins: vec![self.host.clone()],
        }
    }

    /// The one seam `run_pipeline` allows a test to substitute. Recognises
    /// exactly `(self.host, 80)` — the only pair `admission::decide` will
    /// ever admit for this scan's origins — and dials the loopback fixture
    /// listener directly, performing no name resolution at all. Anything
    /// else reaching this connector would mean `admission::decide` admitted
    /// a host this scan never should have, so it is refused rather than
    /// guessed at.
    pub fn connector(&self) -> proxy::Connector {
        let host = self.host.clone();
        let origin_port = self.origin_port;
        Arc::new(move |h: String, p: u16| {
            let dial = (h == host && p == 80).then_some(origin_port);
            Box::pin(async move {
                match dial {
                    Some(port) => TcpStream::connect(("127.0.0.1", port)).await,
                    None => Err(std::io::Error::other(
                        "test connector: admitted a host the fixture does not recognise",
                    )),
                }
            }) as proxy::BoxFuture<'static, std::io::Result<TcpStream>>
        })
    }
}

/// `fixture_site_serving` with `FIXTURE_HTML` as the home page.
pub async fn fixture_site() -> Site {
    fixture_site_serving(vec![("/", FIXTURE_HTML.into())]).await
}

/// Starts the loopback fixture server and returns the `Site` describing it.
/// Each `(path, html)` pair is served on an exact path match (`/` = home);
/// any other path is a 404. A fresh listener and a fresh, port-derived host
/// per call, so concurrent tests never share one scan's admitted origin with
/// another's.
pub async fn fixture_site_serving(pages: Vec<(&'static str, String)>) -> Site {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind loopback fixture listener");
    let addr: SocketAddr = listener.local_addr().expect("fixture listener address");
    let pages = Arc::new(pages);
    tokio::spawn(async move {
        loop {
            let Ok((stream, _peer)) = listener.accept().await else {
                break;
            };
            tokio::spawn(serve_fixture_page(stream, Arc::clone(&pages)));
        }
    });
    Site {
        host: format!("scan-fixture-{}.invalid", addr.port()),
        origin_port: addr.port(),
    }
}

/// Runs the real pipeline against `site` and returns what the renderer would
/// receive, panicking on a failed scan.
pub async fn scan(site: &Site) -> ScanOutput {
    let run = scan::run_scan_for_test(Arc::new(ScanState::default()), site.target(), site.connector())
        .await
        .expect("scan should start");
    run.result.expect("scan should complete")
}

/// Answers one plain-HTTP request with the page registered for its path.
///
/// Reads to EOF rather than one `read()` call, because `proxy.rs`'s
/// plain-HTTP forwarding always shuts its write half immediately after
/// sending the request head (there is no body to follow — see `proxy.rs`'s
/// `Mode::Forward` arm) before reading the response. That is a normal
/// TCP half-close, not an abort, and an HTTP/1.1 origin server is expected to
/// keep reading and then respond; reading to EOF here is what makes this
/// fixture that kind of server rather than one that answers before the whole
/// request has arrived. Carried risk (a) from the task brief — whether a
/// *real* origin server would instead treat the early FIN as an abort — is
/// a property of servers this suite does not control and remains open.
async fn serve_fixture_page(mut stream: TcpStream, pages: Arc<Vec<(&'static str, String)>>) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    let path = request_path(&String::from_utf8_lossy(&buf));
    let response = match pages.iter().find(|(p, _)| *p == path) {
        Some((_, html)) => format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            html.len(),
            html,
        ),
        None => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
    };
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// The path of the request line. The proxy forwards the absolute-form target
/// as it arrived (`GET http://host/path HTTP/1.1`), so the scheme and
/// authority are stripped when present.
fn request_path(request: &str) -> String {
    let target = request.split_whitespace().nth(1).unwrap_or("");
    let path = match target.strip_prefix("http://") {
        Some(rest) => rest.find('/').map_or("/", |i| &rest[i..]),
        None => target,
    };
    path.to_string()
}
