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
use std::net::{IpAddr, SocketAddr};
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

/// RFC 1035's cap on a domain name. `admission::vet_host` refuses anything longer, so a recorded
/// authority above this length is by definition one the guard rejected, and there is no reason to
/// retain the rest of it.
const MAX_RECORDED_HOST: usize = 253;
/// The detail record is bounded. A local process can drive refusals at will, and this ledger
/// lives inside an app holding the user's unsaved project; unbounded growth driven by an
/// untrusted peer is not a property that belongs there. The counts are not capped — see
/// `Ledger::outcomes` — so a truncated record shows up as a gap rather than as a clean sheet.
const MAX_LEDGER_ENTRIES: usize = 10_000;

/// Make an authority safe to retain and later render.
///
/// `DenyReason` is an enum precisely so no deny reason can carry a value, but the ledger pairs
/// the reason with the host anyway — and on the deny path that host is the *raw* authority off
/// the request line, which the guard refused rather than vetted. It can be 8 KB long and can
/// carry control characters: `"evil\u{1b}[2Kspoof.example"` is a valid CONNECT authority as far
/// as the read loop is concerned, and it rewrites a terminal line when printed. Capping and
/// reducing to printable ASCII here is what keeps the enum's guarantee from being undone one
/// line later.
fn redact_authority(raw: String) -> String {
    if raw.len() <= MAX_RECORDED_HOST && raw.bytes().all(|b| b.is_ascii_graphic()) {
        return raw;
    }
    raw.chars()
        .take(MAX_RECORDED_HOST)
        .map(|c| if c.is_ascii_graphic() { c } else { '?' })
        .collect()
}

const REFUSED: &[u8] = b"HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
const ESTABLISHED: &[u8] = b"HTTP/1.1 200 Connection Established\r\n\r\n";
const UPSTREAM_FAILED: &[u8] =
    b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";

/// The record of what the guard saw, and — just as importantly — the evidence that it was still
/// awake while it saw it.
///
/// During the spike the observing proxy crashed mid-run and silently under-reported a clean
/// result; it was caught only because the number looked impossible. The counted contract below
/// makes that impossible to miss: every accepted connection increments `accepted` and reaches
/// exactly one recorded outcome — an entry in `allowed`, an entry in `denied`, or a tick of
/// `refused` for a connection that ended before any host was known. `healthy()` is the
/// reconciliation of those two numbers, and every test that concludes "nothing escaped" must
/// assert it before believing itself.
///
/// The reconciliation is deliberately against `accepted`, not against `completed`. Outcomes are
/// recorded at the moment of decision, while `completed` only ticks when the handler returns —
/// which for an established tunnel means when the tunnel closes. Reconciling against `completed`
/// would report every keep-alive connection of a real scan as a dead sensor, exactly when §9.3
/// needs the check to be meaningful. `completed` is kept as an observable, not as the invariant.
#[derive(Debug, Default)]
pub struct Ledger {
    allowed: Mutex<Vec<(String, u16)>>,
    denied: Mutex<Vec<(String, u16, DenyReason)>>,
    accepted: AtomicU64,
    completed: AtomicU64,
    /// Terminal states that never learned a host: a timed-out or oversized preamble, bytes that
    /// were not UTF-8, a method that was not CONNECT, an authority with no parseable port. There
    /// is nothing to name in the record — nothing was contacted — but the connection must still
    /// be accountable, or `accepted` cannot be reconciled against anything.
    refused: AtomicU64,
    /// Accounting, kept separately from the detail vectors above so that capping the record
    /// cannot quietly cap the reconciliation. If these tracked `Vec::len` then filling the
    /// detail record would make `healthy()` start failing, and the fix under pressure would be
    /// to weaken `healthy()`.
    allowed_count: AtomicU64,
    denied_count: AtomicU64,
    /// Outcomes that were counted but whose detail was not retained, because the record was
    /// full or its lock was poisoned. Never silently zero: a caller reading the ledger needs to
    /// know the difference between "nothing else happened" and "we stopped writing it down".
    dropped_records: AtomicU64,
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
        self.allowed_count.fetch_add(1, Ordering::SeqCst);
        // No redaction here: an allowed host has been through `admission::vet_host`, so it is
        // already lowercase ASCII within the length cap. The deny path is the one that records
        // a string the guard refused rather than approved.
        match self.allowed.lock() {
            Ok(mut v) if v.len() < MAX_LEDGER_ENTRIES => v.push((host, port)),
            _ => {
                self.dropped_records.fetch_add(1, Ordering::SeqCst);
            }
        }
    }
    fn note_denied(&self, host: String, port: u16, reason: DenyReason) {
        self.denied_count.fetch_add(1, Ordering::SeqCst);
        match self.denied.lock() {
            Ok(mut v) if v.len() < MAX_LEDGER_ENTRIES => {
                v.push((redact_authority(host), port, reason))
            }
            _ => {
                self.dropped_records.fetch_add(1, Ordering::SeqCst);
            }
        }
    }
    fn note_refused(&self) {
        self.refused.fetch_add(1, Ordering::SeqCst);
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
    pub fn refused(&self) -> u64 {
        self.refused.load(Ordering::SeqCst)
    }
    /// Outcomes that were counted but not written down — the detail record was full, or its lock
    /// was poisoned. A non-zero value means `allowed()` and `denied()` are incomplete.
    pub fn dropped_records(&self) -> u64 {
        self.dropped_records.load(Ordering::SeqCst)
    }
    /// Every accepted connection, accounted for exactly once. Counted, not measured off the
    /// detail vectors, so that capping the record cannot weaken the reconciliation.
    pub fn outcomes(&self) -> u64 {
        self.allowed_count.load(Ordering::SeqCst)
            + self.denied_count.load(Ordering::SeqCst)
            + self.refused()
    }
    pub fn healthy(&self) -> bool {
        self.handler_panics.load(Ordering::SeqCst) == 0 && self.accepted() == self.outcomes()
    }
}

pub struct ProxyHandle {
    pub addr: SocketAddr,
    pub ledger: Arc<Ledger>,
}

/// Whether an address the resolver returned may be dialled.
///
/// `admission::decide` denies IP literals and its comment claims that closes loopback pivots and
/// the cloud metadata endpoint. It does not, and cannot: it sees an authority string, while the
/// connector resolves a *name*. The owner of a scan target controls its DNS, so
/// `internal.rossi-editore.it` can hold an A record of `127.0.0.1` or `169.254.169.254` and pass
/// the label-boundary suffix match honestly. Without this check the guard would admit it and the
/// proxy would dial the user's own loopback services, their LAN, or the metadata endpoint of the
/// machine the app happens to be running on.
///
/// The rule is stated as an exclusion list rather than an allowlist because the set of routable
/// unicast addresses is the complement of a short, stable set of special-purpose ranges, and
/// several of the standard-library predicates for those ranges (`is_global`, `is_shared`,
/// `is_unique_local`) are still unstable — so the ranges are spelled out here.
fn is_permitted_upstream(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => {
            let o = a.octets();
            !(a.is_loopback()                        // 127.0.0.0/8
                || a.is_private()                    // 10/8, 172.16/12, 192.168/16
                || a.is_link_local()                 // 169.254/16 — the metadata endpoint
                || a.is_broadcast()
                || a.is_documentation()              // 192.0.2/24, 198.51.100/24, 203.0.113/24
                || a.is_unspecified()
                || o[0] == 0                         // 0.0.0.0/8 "this network"
                || (o[0] == 100 && (64..=127).contains(&o[1])) // 100.64/10 CGNAT
                || (o[0] == 192 && o[1] == 0 && o[2] == 0)     // 192.0.0/24 IETF protocol
                || (o[0] == 198 && (18..=19).contains(&o[1]))  // 198.18/15 benchmarking
                || o[0] >= 224) // 224/4 multicast, 240/4 reserved, 255.255.255.255
        }
        IpAddr::V6(a) => {
            // An IPv4 address wearing an IPv6 hat is still that IPv4 address. `to_ipv4` covers
            // both the mapped (::ffff:a.b.c.d) and the deprecated compatible (::a.b.c.d) forms,
            // either of which would otherwise smuggle 127.0.0.1 past the checks below.
            if let Some(v4) = a.to_ipv4() {
                return is_permitted_upstream(IpAddr::V4(v4));
            }
            let s = a.segments();
            !(a.is_loopback()
                || a.is_unspecified()
                || a.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00   // fc00::/7 unique local
                || (s[0] & 0xffc0) == 0xfe80)  // fe80::/10 link-local unicast
        }
    }
}

/// Dial the first permitted address, or refuse outright if any resolved address is not permitted.
///
/// Refusing the whole connection rather than skipping the bad address and trying the next is
/// deliberate. A name that resolves to both a public address and `127.0.0.1` is not a name this
/// product has any reason to reach, and quietly using the acceptable half would turn a rebinding
/// attempt into a silent success. Failing closed is the only acceptable direction.
///
/// The error carries no host and no address: it becomes a 502 to the client either way, and a
/// connector error is not a channel for map content.
/// True if the resolved set contains anything that must not be dialled, or is empty.
///
/// Separate from the dialling below, and checked in full before a single connection is opened, so
/// that "one bad address refuses the whole set" is a property of the code rather than of the
/// order the resolver happened to return. It is also what lets the test for this assert the
/// mixed-set case without the suite ever opening a socket to a non-loopback address.
fn any_address_refused(addrs: &[SocketAddr]) -> bool {
    addrs.is_empty() || !addrs.iter().all(|a| is_permitted_upstream(a.ip()))
}

async fn connect_to_permitted(
    addrs: impl IntoIterator<Item = SocketAddr>,
) -> std::io::Result<TcpStream> {
    let addrs: Vec<SocketAddr> = addrs.into_iter().collect();
    if any_address_refused(&addrs) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "upstream address refused",
        ));
    }
    let mut last: Option<std::io::Error> = None;
    for addr in addrs {
        match TcpStream::connect(addr).await {
            Ok(s) => return Ok(s),
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::PermissionDenied, "upstream address refused")
    }))
}

/// The connector the application installs. Tests never use it: a test that dials anything but
/// 127.0.0.1 violates the product's own promise (Global Constraints), so every test injects a
/// connector pointed at a local stand-in. Resolution is done here rather than inside
/// `TcpStream::connect` so that every address it produces is checked before anything is dialled.
pub fn real_connector() -> Connector {
    Arc::new(|host: String, port: u16| {
        Box::pin(async move {
            let addrs = tokio::net::lookup_host((host.as_str(), port)).await?;
            connect_to_permitted(addrs).await
        }) as BoxFuture<'static, std::io::Result<TcpStream>>
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
        // A timeout, an oversized preamble, bytes that were not UTF-8, or a client that closed
        // without speaking. Nothing was contacted, so there is no host to record — but the
        // connection is still counted, or `accepted` reconciles against nothing.
        ledger.note_refused();
        let _ = client.write_all(REFUSED).await;
        return;
    };

    let Some((host, port)) = parse_connect_authority(&head) else {
        // Not a CONNECT, or an authority that could not be read. Either way it does not become a
        // tunnel, and there is no host worth recording against a scan — but see above: counted.
        ledger.note_refused();
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
        Decision::Allow { host: approved, origin: _ } => {
            // Recorded at the moment of admission, not at the moment of success. An upstream that
            // then refuses the connection must not vanish from the record.
            //
            // Both the record and the connect use `approved` — the host the guard normalised and
            // vetted — never the raw authority off the request line and never the scan origin it
            // matched. Recording the origin would collapse every subdomain of a scan target into
            // the apex, losing the vendors the map exists to show; connecting to the raw string
            // would hand the resolver a name the guard never saw.
            ledger.note_allowed(approved.clone(), port);
            match connect(approved, port).await {
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

    /// Records every host the connector was handed, so a test can assert on the exact string
    /// that would have reached the OS resolver.
    fn recording_connector(addr: SocketAddr) -> (Connector, Arc<Mutex<Vec<String>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let c: Connector = Arc::new(move |host: String, _port: u16| {
            if let Ok(mut v) = sink.lock() {
                v.push(host);
            }
            Box::pin(async move { TcpStream::connect(addr).await })
                as BoxFuture<'static, std::io::Result<TcpStream>>
        });
        (c, seen)
    }

    #[tokio::test]
    async fn the_ledger_records_each_subdomain_contacted_not_the_scan_origin() {
        // Audit finding F1. Before the fix all three of these were recorded as
        // `rossi-editore.it`, so a third-party vendor served from `analytics.` — the exact thing
        // the map exists to surface — was indistinguishable from the site's own apex.
        let upstream = fake_upstream(b"pong").await;
        let p = start(origins(&["rossi-editore.it"]), connector_to(upstream)).await.unwrap();

        for host in ["www.rossi-editore.it", "analytics.rossi-editore.it", "rossi-editore.it"] {
            let mut s = TcpStream::connect(p.addr).await.unwrap();
            s.write_all(format!("CONNECT {host}:443 HTTP/1.1\r\n\r\n").as_bytes()).await.unwrap();
            let mut head = [0u8; 39];
            s.read_exact(&mut head).await.unwrap();
            drop(s);
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
        let mut recorded: Vec<String> = p.ledger.allowed().into_iter().map(|(h, _)| h).collect();
        recorded.sort();
        assert_eq!(
            recorded,
            vec![
                "analytics.rossi-editore.it".to_string(),
                "rossi-editore.it".to_string(),
                "www.rossi-editore.it".to_string(),
            ]
        );
        assert_sensor_alive(&p.ledger);
    }

    #[tokio::test]
    async fn the_connector_is_handed_the_host_the_guard_vetted_not_the_raw_authority() {
        // Audit finding F3. `str::trim` strips the whole Unicode `White_Space` set, so the raw
        // authority `decide` was asked about and the string it approved are not the same bytes.
        // Only the approved one may reach a resolver.
        let upstream = fake_upstream(b"pong").await;
        let (connector, seen) = recording_connector(upstream);
        let p = start(origins(&["rossi-editore.it"]), connector).await.unwrap();

        for authority in ["WWW.RoSSi-EDITORE.IT", "rossi-editore.it.", "\u{a0}rossi-editore.it"] {
            let mut s = TcpStream::connect(p.addr).await.unwrap();
            s.write_all(format!("CONNECT {authority}:443 HTTP/1.1\r\n\r\n").as_bytes())
                .await
                .unwrap();
            let mut head = [0u8; 39];
            let _ = s.read_exact(&mut head).await;
            drop(s);
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
        let mut got = seen.lock().unwrap().clone();
        got.sort();
        assert_eq!(
            got,
            vec![
                "rossi-editore.it".to_string(),
                "rossi-editore.it".to_string(),
                "www.rossi-editore.it".to_string(),
            ],
            "the connector was given a string the guard never vetted"
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

    // ---- audit finding F4 --------------------------------------------------

    #[tokio::test]
    async fn a_refused_authority_is_recorded_capped_and_free_of_control_characters() {
        // F4. DenyReason is an enum so that no reason can carry a value, but the ledger pairs the
        // reason with the raw authority — which the guard *refused*, so it is subject to no cap
        // and no character rule at all. Before the fix a 7000-character authority was retained in
        // full, and an ESC sequence in a hostname survived into anything that later rendered the
        // record.
        let p = start(origins(&["rossi-editore.it"]), connector_that_must_never_be_called())
            .await
            .unwrap();

        let long = "a".repeat(7000);
        let _ = send(p.addr, &format!("CONNECT {long}.example:443 HTTP/1.1\r\n\r\n")).await;
        let _ = send(p.addr, "CONNECT evil\u{1b}[2Kspoof.example:443 HTTP/1.1\r\n\r\n").await;
        let _ = send(p.addr, "CONNECT \u{7}bell.example:443 HTTP/1.1\r\n\r\n").await;

        tokio::time::sleep(Duration::from_millis(100)).await;
        let denied = p.ledger.denied();
        assert_eq!(denied.len(), 3);
        for (h, _, _) in &denied {
            assert!(h.len() <= MAX_RECORDED_HOST, "retained {} bytes: {h:?}", h.len());
            assert!(
                h.bytes().all(|b| b.is_ascii_graphic()),
                "a control character survived into the record: {h:?}"
            );
        }
        // and the redaction is visible rather than silent
        assert!(denied.iter().any(|(h, _, _)| h.contains('?')));
        assert_sensor_alive(&p.ledger);
    }

    #[test]
    fn the_detail_record_is_capped_while_the_accounting_is_not() {
        // An untrusted local peer can drive refusals at will, into a ledger living inside an app
        // that holds the user's unsaved project. The record stops growing; the reconciliation
        // does not, so a capped record still reads as a live sensor rather than a dead one.
        let l = Ledger::new();
        for i in 0..(MAX_LEDGER_ENTRIES + 50) {
            l.note_accepted();
            l.note_denied(format!("h{i}.example"), 443, DenyReason::NotAScanTarget);
        }
        assert_eq!(l.denied().len(), MAX_LEDGER_ENTRIES);
        assert_eq!(l.dropped_records(), 50, "a truncated record must be visible, not silent");
        assert_eq!(l.outcomes(), (MAX_LEDGER_ENTRIES + 50) as u64);
        assert!(l.healthy(), "capping the record must not make the sensor read as dead");
    }

    // ---- audit findings F5 and F6 ------------------------------------------

    #[tokio::test]
    async fn a_connection_refused_before_a_host_is_known_is_still_accounted_for() {
        // F5, and it is the spike's exact failure. These three reach a terminal state — a 403 and
        // a closed socket — without `handle` ever learning a host, so nothing lands in `allowed`
        // or `denied`. Before the fix the ledger read accepted=3, allowed=0, denied=0 and
        // healthy()=true: a sensor that saw nothing, reporting itself well.
        let p = start(origins(&["rossi-editore.it"]), connector_that_must_never_be_called())
            .await
            .unwrap();

        // an authority with no port at all — `rsplit_once(':')` finds nothing
        let _ = send(p.addr, "CONNECT rossi-editore.it HTTP/1.1\r\n\r\n").await;
        // a method that is not CONNECT
        let _ = send(p.addr, "GET / HTTP/1.1\r\nHost: rossi-editore.it\r\n\r\n").await;
        // a client that connects and says nothing at all
        drop(TcpStream::connect(p.addr).await.unwrap());

        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(p.ledger.accepted(), 3);
        assert!(p.ledger.allowed().is_empty());
        assert!(p.ledger.denied().is_empty());
        assert_eq!(
            p.ledger.refused(), 3,
            "a terminal state that recorded no outcome is unaccountable — accepted cannot be \
             reconciled against what the ledger saw, which is how the spike's oracle died quietly"
        );
        assert_sensor_alive(&p.ledger);
    }

    #[tokio::test]
    async fn an_unaccounted_connection_makes_the_sensor_read_unhealthy() {
        // The tripwire is not vacuous: an accept with no outcome behind it must fail the check,
        // otherwise the reconciliation above proves nothing.
        let ledger = Ledger::new();
        ledger.note_accepted();
        assert!(!ledger.healthy());
        ledger.note_refused();
        assert!(ledger.healthy());
    }

    #[tokio::test]
    async fn the_sensor_reads_healthy_while_a_tunnel_is_still_open() {
        // F6. `copy_bidirectional` does not return until the tunnel closes, so under the old
        // accepted == completed rule every keep-alive connection of a real scan read as a dead
        // sensor. The §9.3 egress test must assert healthy() *during* a scan; a rule that is
        // false exactly then invites someone to weaken it, which would throw away the tripwire
        // the spike paid for.
        let upstream = fake_upstream(b"pong").await;
        let p = start(origins(&["rossi-editore.it"]), connector_to(upstream)).await.unwrap();

        let mut s = TcpStream::connect(p.addr).await.unwrap();
        s.write_all(b"CONNECT rossi-editore.it:443 HTTP/1.1\r\n\r\n").await.unwrap();
        let mut head = [0u8; 39];
        s.read_exact(&mut head).await.unwrap();

        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(p.ledger.completed(), 0, "the tunnel should still be open");
        assert_eq!(p.ledger.allowed(), vec![("rossi-editore.it".to_string(), 443)]);
        assert!(
            p.ledger.healthy(),
            "an open tunnel is a working sensor, not a dead one: accepted={} completed={}",
            p.ledger.accepted(),
            p.ledger.completed()
        );
        drop(s);
    }

    // ---- audit finding F2 --------------------------------------------------

    #[test]
    fn refuses_every_address_that_is_not_a_routable_unicast_destination() {
        // `admission::decide` denies IP *literals*; it cannot deny a *name* that resolves to one
        // of these, because the owner of the scan target writes its own DNS. 169.254.169.254 is
        // the cloud metadata endpoint the admission comment claims to close and does not.
        let denied = [
            "127.0.0.1", "127.1.2.3", "0.0.0.0", "0.1.2.3",
            "169.254.169.254", "169.254.0.1",
            "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1",
            "100.64.0.1", "100.127.255.255",
            "192.0.0.1", "192.0.2.5", "198.51.100.5", "203.0.113.5",
            "198.18.0.1", "198.19.255.255",
            "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
            "::1", "::", "ff02::1",
            "fc00::1", "fd12:3456::1", "fe80::1",
            // an IPv4 address wearing an IPv6 hat is still that IPv4 address
            "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::127.0.0.1",
        ];
        for a in denied {
            let ip: IpAddr = a.parse().unwrap();
            assert!(!is_permitted_upstream(ip), "{a} should not be dialled");
        }

        let permitted = ["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:2800:220:1::1"];
        for a in permitted {
            let ip: IpAddr = a.parse().unwrap();
            assert!(is_permitted_upstream(ip), "{a} is an ordinary destination and must dial");
        }
    }

    #[tokio::test]
    async fn will_not_dial_a_loopback_address_even_when_something_is_listening_on_it() {
        // The wiring, not just the predicate. `fake_upstream` binds 127.0.0.1 and is genuinely
        // accepting connections, so a connector without the check would succeed here — which is
        // precisely the rebinding outcome: the admitted name resolved to the user's own machine.
        // No DNS is involved, so the suite still never resolves or dials anything off-machine.
        let listening = fake_upstream(b"pong").await;
        let err = connect_to_permitted([listening]).await.expect_err("dialled loopback");
        assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied);
    }

    #[test]
    fn a_mixed_answer_is_refused_outright_rather_than_using_the_acceptable_half() {
        // Asserted against the pure check rather than by dialling: a name that resolves to both a
        // public address and 127.0.0.1 must be refused whole, and proving that by calling
        // `connect_to_permitted` would mean the suite either dials the public address or relies
        // on the resolver's ordering to avoid it. Neither is acceptable under Global Constraints.
        let public: SocketAddr = "93.184.216.34:443".parse().unwrap();
        let loopback: SocketAddr = "127.0.0.1:443".parse().unwrap();
        let metadata: SocketAddr = "169.254.169.254:80".parse().unwrap();

        assert!(!any_address_refused(&[public]));
        assert!(any_address_refused(&[public, loopback]), "the acceptable half must not save it");
        assert!(any_address_refused(&[loopback, public]), "and the order must not matter");
        assert!(any_address_refused(&[public, metadata]));
        assert!(any_address_refused(&[]), "an empty resolution is a refusal, not a success");
    }

    #[tokio::test]
    async fn the_listener_binds_loopback_only() {
        let p = start(origins(&[]), connector_that_must_never_be_called()).await.unwrap();
        assert!(p.addr.ip().is_loopback(), "proxy bound {} — reachable from another machine", p.addr);
        assert_sensor_alive(&p.ledger);
    }
}
