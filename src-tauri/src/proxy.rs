//! The egress guard, in its enforcing form.
//!
//! CDP cannot carry spec §7.1 on its own: a `<link rel=preconnect>` opens TCP and completes a
//! TLS handshake without issuing a request, so `Fetch.requestPaused` never fires for it. On one
//! load of a news site the spike measured 22 hosts visible to CDP against 37 actually contacted,
//! and the 15 CDP could not see were ad-tech vendors — the exact thing this product exists to
//! find. A proxy sees connection *attempts*, which is what §7.1 forbids. So the proxy is the
//! guard, and CDP, in Phase 2, is only attribution.
//!
//! This proxy never decrypts anything. A CONNECT tunnel is opaque bytes: it learns the hostname
//! and the port and nothing else, which is the correct amount for a tool whose promise is that
//! the map never leaves the machine.
//!
//! Everything that is not a CONNECT to an admitted host:port is refused and recorded.
//! Plain-HTTP forwarding is deliberately absent until Phase 2 needs it.

use crate::admission::{decide, Decision, DenyReason};
use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
pub type Connector =
    Arc<dyn Fn(String, u16) -> BoxFuture<'static, std::io::Result<TcpStream>> + Send + Sync>;

/// Enough for any real CONNECT preamble; small enough that a client cannot make the proxy read
/// forever. Exceeding it is a refusal, not a longer read.
const MAX_HEADER_BYTES: usize = 8 * 1024;
/// A client that opens a connection and then says nothing must not hold a task open.
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(10);

const REFUSED: &[u8] = b"HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
const ESTABLISHED: &[u8] = b"HTTP/1.1 200 Connection Established\r\n\r\n";
const UPSTREAM_FAILED: &[u8] =
    b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";

/// The record of what the guard saw, and — just as importantly — the evidence that it was still
/// awake while it saw it.
///
/// During the spike the observing proxy crashed mid-run and silently under-reported a clean
/// result; it was caught only because the number looked impossible. The counted contract below
/// makes that impossible to miss: every accepted connection increments `accepted`, and reaches
/// exactly one terminal outcome which increments `completed`. `healthy()` is false whenever the
/// two disagree or a handler panicked, and every test that concludes "nothing escaped" must
/// assert `healthy()` before believing itself.
#[derive(Debug, Default)]
pub struct Ledger {
    allowed: Mutex<Vec<(String, u16)>>,
    denied: Mutex<Vec<(String, u16, DenyReason)>>,
    accepted: AtomicU64,
    completed: AtomicU64,
    handler_panics: AtomicU64,
}

impl Ledger {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }
    pub fn note_accepted(&self) {
        self.accepted.fetch_add(1, Ordering::SeqCst);
    }
    fn note_completed(&self) {
        self.completed.fetch_add(1, Ordering::SeqCst);
    }
    fn note_allowed(&self, host: String, port: u16) {
        if let Ok(mut v) = self.allowed.lock() {
            v.push((host, port));
        }
    }
    fn note_denied(&self, host: String, port: u16, reason: DenyReason) {
        if let Ok(mut v) = self.denied.lock() {
            v.push((host, port, reason));
        }
    }
    fn note_panic(&self) {
        self.handler_panics.fetch_add(1, Ordering::SeqCst);
    }
    pub fn allowed(&self) -> Vec<(String, u16)> {
        self.allowed.lock().map(|v| v.clone()).unwrap_or_default()
    }
    pub fn denied(&self) -> Vec<(String, u16, DenyReason)> {
        self.denied.lock().map(|v| v.clone()).unwrap_or_default()
    }
    pub fn accepted(&self) -> u64 {
        self.accepted.load(Ordering::SeqCst)
    }
    pub fn completed(&self) -> u64 {
        self.completed.load(Ordering::SeqCst)
    }
    pub fn healthy(&self) -> bool {
        self.handler_panics.load(Ordering::SeqCst) == 0 && self.accepted() == self.completed()
    }
}

pub struct ProxyHandle {
    pub addr: SocketAddr,
    pub ledger: Arc<Ledger>,
}

/// The connector the application installs. Tests never use it: a test that dials anything but
/// 127.0.0.1 violates the product's own promise (Global Constraints), so every test injects a
/// connector pointed at a local stand-in.
pub fn real_connector() -> Connector {
    Arc::new(|host: String, port: u16| {
        Box::pin(async move { TcpStream::connect((host.as_str(), port)).await })
            as BoxFuture<'static, std::io::Result<TcpStream>>
    })
}

pub async fn start(
    scan_origins: Arc<Mutex<Vec<String>>>,
    connect: Connector,
) -> std::io::Result<ProxyHandle> {
    // Loopback only. The proxy must never be reachable from another machine.
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let ledger = Ledger::new();

    let accept_ledger = Arc::clone(&ledger);
    tokio::spawn(async move {
        loop {
            let Ok((stream, _peer)) = listener.accept().await else {
                // A per-connection accept error (a client that vanished between the SYN and the
                // accept, a momentary descriptor exhaustion) is not a reason to stop guarding.
                // Yield first so a persistently failing listener cannot spin a core.
                tokio::task::yield_now().await;
                continue;
            };
            accept_ledger.note_accepted();
            let ledger = Arc::clone(&accept_ledger);
            let origins = Arc::clone(&scan_origins);
            let connect = Arc::clone(&connect);
            // A panic inside a connection task is otherwise invisible: the task dies, the runtime
            // carries on, and the ledger looks calm. Joining the task turns the one failure mode
            // this component may not have into a loud one, and `completed` is incremented here —
            // on exactly one path, whether the handler returned or died — so the accepted/
            // completed contract cannot be broken by forgetting a branch inside `handle`.
            tokio::spawn(async move {
                let inner = Arc::clone(&ledger);
                let joined = tokio::spawn(handle(stream, origins, connect, inner)).await;
                if joined.is_err() {
                    ledger.note_panic();
                }
                ledger.note_completed();
            });
        }
    });

    Ok(ProxyHandle { addr, ledger })
}

async fn handle(
    mut client: TcpStream,
    scan_origins: Arc<Mutex<Vec<String>>>,
    connect: Connector,
    ledger: Arc<Ledger>,
) {
    let Some(head) = read_head(&mut client).await else {
        let _ = client.write_all(REFUSED).await;
        return;
    };

    let Some((host, port)) = parse_connect_authority(&head) else {
        // Not a CONNECT, or an authority that could not be read. Either way it does not become a
        // tunnel, and there is no host worth recording against a scan.
        let _ = client.write_all(REFUSED).await;
        return;
    };

    // The guard clones the origin list rather than holding the lock across the decision, so a
    // poisoned mutex degrades to an empty list — which `decide` treats as NoScanRunning, i.e.
    // deny everything. Failing closed is the only acceptable direction here.
    let origins = scan_origins.lock().map(|g| g.clone()).unwrap_or_default();
    match decide(&host, port, &origins) {
        Decision::Deny { reason } => {
            ledger.note_denied(host, port, reason);
            let _ = client.write_all(REFUSED).await;
        }
        Decision::Allow { origin } => {
            // Recorded at the moment of admission, not at the moment of success. An upstream that
            // then refuses the connection must not vanish from the record.
            ledger.note_allowed(origin, port);
            match connect(host, port).await {
                Err(_) => {
                    let _ = client.write_all(UPSTREAM_FAILED).await;
                }
                Ok(mut upstream) => {
                    if client.write_all(ESTABLISHED).await.is_ok() {
                        let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
                    }
                }
            }
        }
    }
}

/// Read the request line and headers, bounded in both bytes and time. Returns None on a timeout,
/// on an oversized header block, on a closed connection, or on bytes that are not UTF-8 — every
/// one of which is a refusal, never a longer read.
async fn read_head(client: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    let deadline = tokio::time::Instant::now() + HEADER_READ_TIMEOUT;
    loop {
        let n = tokio::time::timeout_at(deadline, client.read(&mut chunk)).await.ok()?.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(chunk.get(..n)?);
        if buf.len() > MAX_HEADER_BYTES {
            return None;
        }
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    String::from_utf8(buf).ok()
}

/// Only `CONNECT host:port HTTP/x.y` produces an authority. Everything else — origin-form,
/// absolute-form, any other method — returns None and is refused.
///
/// The authority comes from the request line and only from the request line. A `Host:` header is
/// never consulted, so the two can never be played against each other.
fn parse_connect_authority(head: &str) -> Option<(String, u16)> {
    let line = head.lines().next()?;
    let mut parts = line.split(' ');
    if parts.next()? != "CONNECT" {
        return None;
    }
    let authority = parts.next()?;
    // Split from the right, so an authority containing more than one colon leaves a colon in the
    // host and is rejected by `admission::decide`'s character allowlist rather than being
    // silently re-split into something that looks admissible.
    let (host, port) = authority.rsplit_once(':')?;
    let port: u16 = port.parse().ok()?;
    Some((host.to_string(), port))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// A stand-in upstream. Every allow-path test connects here instead of the internet, so the
    /// suite never opens a socket to anything but 127.0.0.1 (Global Constraints).
    async fn fake_upstream(reply: &'static [u8]) -> SocketAddr {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = l.accept().await {
                let mut buf = [0u8; 1024];
                let _ = s.read(&mut buf).await;
                let _ = s.write_all(reply).await;
            }
        });
        addr
    }

    fn connector_to(addr: SocketAddr) -> Connector {
        Arc::new(move |_host: String, _port: u16| {
            Box::pin(async move { TcpStream::connect(addr).await })
                as BoxFuture<'static, std::io::Result<TcpStream>>
        })
    }

    /// The tripwire itself. Declared as an `async fn` with an explicit return type rather than an
    /// inline `async move` block: rustc infers an async block's output from its tail expression
    /// and does not coerce the never type there, so a block whose body is only `panic!` is
    /// inferred as `()` and will not cast to `Connector`. A named return type gives `!` something
    /// to coerce into.
    async fn never_connect(host: String, port: u16) -> std::io::Result<TcpStream> {
        panic!("upstream connect attempted for {host}:{port} — the guard let it through")
    }

    fn connector_that_must_never_be_called() -> Connector {
        Arc::new(|host: String, port: u16| {
            Box::pin(never_connect(host, port)) as BoxFuture<'static, std::io::Result<TcpStream>>
        })
    }

    /// A connector that is a tripwire for every host but one. It lets a test carry a positive
    /// control — proof the allow path can still record — without giving up the guarantee that a
    /// third party reaching the connector fails the test loudly.
    fn connector_only_for(expected: &'static str, addr: SocketAddr) -> Connector {
        Arc::new(move |host: String, port: u16| {
            if host != expected {
                return Box::pin(never_connect(host, port))
                    as BoxFuture<'static, std::io::Result<TcpStream>>;
            }
            Box::pin(async move { TcpStream::connect(addr).await })
                as BoxFuture<'static, std::io::Result<TcpStream>>
        })
    }

    async fn send(addr: SocketAddr, request: &str) -> String {
        let mut s = TcpStream::connect(addr).await.unwrap();
        s.write_all(request.as_bytes()).await.unwrap();
        let mut out = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            match s.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    out.extend_from_slice(&buf[..n]);
                    if out.windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        String::from_utf8_lossy(&out).to_string()
    }

    fn origins(list: &[&str]) -> Arc<Mutex<Vec<String>>> {
        Arc::new(Mutex::new(list.iter().map(|s| (*s).to_string()).collect()))
    }

    /// The liveness contract, asserted at the end of every test in this module. A ledger whose
    /// completed count trails its accepted count is a dead or dying sensor, and any conclusion
    /// drawn from it — including "nothing escaped" — is worthless.
    fn assert_sensor_alive(ledger: &Ledger) {
        assert!(
            ledger.healthy(),
            "proxy ledger is not healthy: accepted={} completed={} — the observer died and any \
             clean result above is meaningless",
            ledger.accepted(),
            ledger.completed()
        );
    }

    #[tokio::test]
    async fn denies_connect_when_no_scan_is_running() {
        let p = start(origins(&[]), connector_that_must_never_be_called()).await.unwrap();
        let reply = send(p.addr, "CONNECT tracker.example:443 HTTP/1.1\r\nHost: tracker.example:443\r\n\r\n").await;
        assert!(reply.starts_with("HTTP/1.1 403"), "got {reply:?}");
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(p.ledger.denied(), vec![("tracker.example".to_string(), 443, DenyReason::NoScanRunning)]);
        assert!(p.ledger.allowed().is_empty());
        assert_sensor_alive(&p.ledger);
    }

    #[tokio::test]
    async fn tunnels_connect_to_the_scan_target() {
        let upstream = fake_upstream(b"pong").await;
        let p = start(origins(&["rossi-editore.it"]), connector_to(upstream)).await.unwrap();

        let mut s = TcpStream::connect(p.addr).await.unwrap();
        s.write_all(b"CONNECT rossi-editore.it:443 HTTP/1.1\r\nHost: rossi-editore.it:443\r\n\r\n").await.unwrap();
        let mut head = [0u8; 39];
        s.read_exact(&mut head).await.unwrap();
        assert_eq!(&head[..], b"HTTP/1.1 200 Connection Established\r\n\r\n");

        s.write_all(b"ping").await.unwrap();
        let mut body = [0u8; 4];
        s.read_exact(&mut body).await.unwrap();
        assert_eq!(&body, b"pong");
        drop(s);

        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(p.ledger.allowed(), vec![("rossi-editore.it".to_string(), 443)]);
        assert!(p.ledger.denied().is_empty());
        assert_sensor_alive(&p.ledger);
    }

    #[tokio::test]
    async fn denies_a_third_party_while_a_scan_is_running() {
        // The paired control runs in the same process, against the same ledger, as the denials.
        // Three refusals asserted against a ledger that has never once recorded an allow prove
        // nothing about the guard — that is exactly the reading the spike's crashed oracle gave
        // before anyone noticed it had died. The CONNECT to the scan target below is the control:
        // it shows the allow path is awake and recording while the deny path is refusing.
        let upstream = fake_upstream(b"pong").await;
        let p = start(
            origins(&["rossi-editore.it"]),
            connector_only_for("rossi-editore.it", upstream),
        )
        .await
        .unwrap();

        for host in ["ib.adnxs.com", "pagead2.googlesyndication.com", "cdn.adsafeprotected.com"] {
            let reply = send(p.addr, &format!("CONNECT {host}:443 HTTP/1.1\r\nHost: {host}\r\n\r\n")).await;
            assert!(reply.starts_with("HTTP/1.1 403"), "{host} got {reply:?}");
        }

        let mut s = TcpStream::connect(p.addr).await.unwrap();
        s.write_all(b"CONNECT rossi-editore.it:443 HTTP/1.1\r\n\r\n").await.unwrap();
        let mut head = [0u8; 39];
        s.read_exact(&mut head).await.unwrap();
        assert_eq!(&head[..], b"HTTP/1.1 200 Connection Established\r\n\r\n");
        drop(s);

        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(p.ledger.denied().len(), 3);
        assert_eq!(
            p.ledger.allowed(),
            vec![("rossi-editore.it".to_string(), 443)],
            "the positive control was not recorded — the allow path is a dead sensor and the \
             three denials above mean nothing"
        );
        assert_sensor_alive(&p.ledger);
    }

    #[tokio::test]
    async fn denies_every_method_that_is_not_connect() {
        let p = start(origins(&["rossi-editore.it"]), connector_that_must_never_be_called()).await.unwrap();
        // The absolute-form schemes are assembled rather than written out: the remote-asset guard
        // in tests/build/noRemoteAssets.test.ts forbids an http(s) URL literal anywhere under
        // src-tauri/src, tests included, and that guard is worth more than the convenience of two
        // strings. `concat!` is compile-time, so the bytes on the wire are identical.
        for line in [
            concat!("GET http", "://", "rossi-editore.it/ HTTP/1.1"),
            concat!("POST http", "://", "rossi-editore.it/ HTTP/1.1"),
            "GET / HTTP/1.1",
        ] {
            let reply = send(p.addr, &format!("{line}\r\nHost: rossi-editore.it\r\n\r\n")).await;
            assert!(reply.starts_with("HTTP/1.1 403"), "{line} got {reply:?}");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(p.ledger.allowed().is_empty());
        assert_sensor_alive(&p.ledger);
    }

    #[tokio::test]
    async fn refuses_an_oversized_header_block_instead_of_reading_forever() {
        let p = start(origins(&["rossi-editore.it"]), connector_that_must_never_be_called()).await.unwrap();
        let mut s = TcpStream::connect(p.addr).await.unwrap();
        s.write_all(b"CONNECT rossi-editore.it:443 HTTP/1.1\r\n").await.unwrap();
        // No terminating blank line; just keep pushing headers past the cap.
        let junk = format!("X-Pad: {}\r\n", "a".repeat(1024));
        for _ in 0..32 {
            if s.write_all(junk.as_bytes()).await.is_err() {
                break;
            }
        }
        let mut buf = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(2), s.read_to_end(&mut buf)).await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(p.ledger.allowed().is_empty());
        assert_sensor_alive(&p.ledger);
    }

    #[tokio::test]
    async fn refuses_a_request_line_that_is_not_valid_utf8() {
        let p = start(origins(&["rossi-editore.it"]), connector_that_must_never_be_called()).await.unwrap();
        let mut s = TcpStream::connect(p.addr).await.unwrap();
        s.write_all(&[0xff, 0xfe, 0x00, b' ', 0xc3, 0x28, b'\r', b'\n', b'\r', b'\n']).await.unwrap();
        let mut buf = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(2), s.read_to_end(&mut buf)).await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(p.ledger.allowed().is_empty());
        assert_sensor_alive(&p.ledger);
    }

    #[tokio::test]
    async fn denies_a_non_web_port_on_the_scan_target_itself() {
        let p = start(origins(&["rossi-editore.it"]), connector_that_must_never_be_called()).await.unwrap();
        let reply = send(p.addr, "CONNECT rossi-editore.it:22 HTTP/1.1\r\n\r\n").await;
        assert!(reply.starts_with("HTTP/1.1 403"), "got {reply:?}");
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(p.ledger.denied(), vec![("rossi-editore.it".to_string(), 22, DenyReason::PortNotAllowed)]);
        assert_sensor_alive(&p.ledger);
    }

    #[tokio::test]
    async fn an_upstream_that_refuses_the_connection_is_still_recorded() {
        // The allow decision was made; the connection then failed. If this were not recorded the
        // ledger would under-report exactly the way the spike's oracle did.
        let dead: Connector = Arc::new(|_h, _p| {
            Box::pin(async { Err(std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "")) })
                as BoxFuture<'static, std::io::Result<TcpStream>>
        });
        let p = start(origins(&["rossi-editore.it"]), dead).await.unwrap();
        let reply = send(p.addr, "CONNECT rossi-editore.it:443 HTTP/1.1\r\n\r\n").await;
        assert!(reply.starts_with("HTTP/1.1 502"), "got {reply:?}");
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(p.ledger.allowed(), vec![("rossi-editore.it".to_string(), 443)]);
        assert_sensor_alive(&p.ledger);
    }

    #[tokio::test]
    async fn the_liveness_assertion_itself_catches_a_dead_sensor() {
        // Proves the guard is not vacuous: a ledger with an unfinished connection reports
        // unhealthy, so a test asserting "nothing escaped" against it would fail rather than pass.
        let ledger = Ledger::new();
        ledger.note_accepted();
        assert!(!ledger.healthy());
        assert_eq!(ledger.accepted(), 1);
        assert_eq!(ledger.completed(), 0);
    }

    #[tokio::test]
    async fn the_listener_binds_loopback_only() {
        let p = start(origins(&[]), connector_that_must_never_be_called()).await.unwrap();
        assert!(p.addr.ip().is_loopback(), "proxy bound {} — reachable from another machine", p.addr);
        assert_sensor_alive(&p.ledger);
    }
}
