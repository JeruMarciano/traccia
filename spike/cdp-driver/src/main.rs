//! Throwaway spike. Answers one question and is then deleted:
//!
//!   Can a Rust process (the shape a Tauri backend takes) drive an
//!   already-installed Chromium-family browser over the Chrome DevTools
//!   Protocol, observe every request a page makes including those from
//!   cross-origin iframes, block chosen hosts before they reach the network,
//!   and attribute each request to before or after consent?
//!
//! Nothing here is written to be ported. The interception loop in particular
//! would need a fresh adversarial audit before it could carry the egress
//! promise; see docs/decisions/2026-07-31-cdp-spike-falsification.md.

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;

// ---------------------------------------------------------------------- errors

/// Every failure a user could hit has a distinct variant with something
/// actionable in it. F7 in the falsification doc turns on this: the app must
/// never present "no browser" as a clean scan, and must never simply hang.
#[derive(Debug)]
enum SpikeError {
    NoBrowserFound { searched: Vec<String> },
    LaunchFailed { path: String, detail: String },
    DebugPortTimeout { path: String, waited_ms: u64 },
    Protocol(String),
}

impl std::fmt::Display for SpikeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SpikeError::NoBrowserFound { searched } => write!(
                f,
                "No Chromium-family browser found. A scan needs Google Chrome, \
                 Microsoft Edge, Brave or Chromium installed.\nLooked in:\n  {}",
                searched.join("\n  ")
            ),
            SpikeError::LaunchFailed { path, detail } => {
                write!(f, "Could not start the browser at {path}: {detail}")
            }
            SpikeError::DebugPortTimeout { path, waited_ms } => write!(
                f,
                "The browser at {path} started but never opened its debugging \
                 port within {waited_ms} ms. It may be an unsupported build."
            ),
            SpikeError::Protocol(m) => write!(f, "DevTools protocol error: {m}"),
        }
    }
}

impl std::error::Error for SpikeError {}

type Result<T> = std::result::Result<T, SpikeError>;

// ------------------------------------------------------------------ discovery

/// Checked in preference order. Chrome and Edge first because those are the
/// two the product assumes; the rest are a courtesy.
const DEFAULT_CANDIDATES: &[&str] = &[
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
];

fn find_browser() -> Result<PathBuf> {
    // Overridable so the no-browser-installed path can actually be provoked
    // rather than reasoned about.
    let candidates: Vec<String> = match std::env::var("SPIKE_BROWSER_CANDIDATES") {
        Ok(v) if !v.is_empty() => v.split(':').map(String::from).collect(),
        _ => DEFAULT_CANDIDATES.iter().map(|s| s.to_string()).collect(),
    };

    for c in &candidates {
        if Path::new(c).is_file() {
            return Ok(PathBuf::from(c));
        }
    }
    Err(SpikeError::NoBrowserFound {
        searched: candidates,
    })
}

// --------------------------------------------------------------------- launch

struct Options {
    url: String,
    blocked: Vec<String>,
    headless: bool,
    harden: bool,
    proxy: Option<String>,
    settle_ms: u64,
    after_consent_ms: u64,
    consent: bool,
}

fn launch_flags(profile: &Path, o: &Options) -> Vec<String> {
    let mut f: Vec<String> = vec![
        // Port 0 asks the browser to pick a free port and write it to
        // DevToolsActivePort inside the profile. Avoids both a fixed-port
        // collision and the need for an HTTP client to query /json/version.
        "--remote-debugging-port=0".into(),
        format!("--user-data-dir={}", profile.display()),
        // F4: an ephemeral profile, per spec 7.5. Also the only way modern
        // Chrome will accept remote debugging at all — it refuses to expose
        // the protocol against the user's default profile.
        "--no-first-run".into(),
        "--no-default-browser-check".into(),
        "--no-service-autorun".into(),
        "--use-mock-keychain".into(),
        // QUIC is UDP and would bypass the HTTP proxy the spike uses as its
        // independent observer, leaving a blind spot the oracle would not
        // report. Turned off so the oracle sees everything.
        "--disable-quic".into(),
    ];

    if o.headless {
        f.push("--headless=new".into());
    }

    if let Some(p) = &o.proxy {
        f.push(format!("--proxy-server={p}"));
        // Loopback is proxy-exempt by default; that exemption is exactly where
        // traffic could hide from the oracle, so it is removed.
        f.push("--proxy-bypass-list=<-loopback>".into());
    }

    if o.harden {
        // F5: everything below exists to stop the browser making requests the
        // app never asked for. Measured with and without.
        f.extend(
            [
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-sync",
                "--disable-domain-reliability",
                "--disable-client-side-phishing-detection",
                "--safebrowsing-disable-auto-update",
                "--disable-breakpad",
                "--no-pings",
                "--metrics-recording-only",
                "--disable-search-engine-choice-screen",
                "--disable-features=OptimizationHints,Translate,MediaRouter,InterestFeedContentSuggestions,AutofillServerCommunication,CertificateTransparencyComponentUpdater,OptimizationGuideModelDownloading,SafeBrowsingExtendedReporting",
                // Brave ships its own update and telemetry services on top of
                // Chromium's.
                "--disable-brave-update",
            ]
            .iter()
            .map(|s| s.to_string()),
        );
    }

    f.push("about:blank".into());
    f
}

async fn wait_for_debug_endpoint(profile: &Path, waited_ms: u64, path: &str) -> Result<String> {
    let marker = profile.join("DevToolsActivePort");
    let deadline = std::time::Instant::now() + Duration::from_millis(waited_ms);

    while std::time::Instant::now() < deadline {
        if let Ok(contents) = tokio::fs::read_to_string(&marker).await {
            let mut lines = contents.lines();
            if let (Some(port), Some(ws_path)) = (lines.next(), lines.next()) {
                if !port.is_empty() && ws_path.starts_with('/') {
                    return Ok(format!("ws://127.0.0.1:{port}{ws_path}"));
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err(SpikeError::DebugPortTimeout {
        path: path.to_string(),
        waited_ms,
    })
}

// ----------------------------------------------------------------- cdp client

/// A CDP connection in flat mode: one socket, many sessions, each command
/// tagged with the session it belongs to.
struct Cdp {
    tx: mpsc::UnboundedSender<Value>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: AtomicU64,
}

impl Cdp {
    async fn connect(url: &str) -> Result<(Arc<Self>, mpsc::UnboundedReceiver<Value>)> {
        let (stream, _) = tokio_tungstenite::connect_async(url)
            .await
            .map_err(|e| SpikeError::Protocol(format!("connect {url}: {e}")))?;
        let (mut sink, mut source) = stream.split();

        let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
        let (ev_tx, ev_rx) = mpsc::unbounded_channel::<Value>();
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if sink.send(Message::Text(msg.to_string())).await.is_err() {
                    break;
                }
            }
        });

        let pending_reader = Arc::clone(&pending);
        tokio::spawn(async move {
            while let Some(Ok(msg)) = source.next().await {
                let Message::Text(text) = msg else { continue };
                let Ok(v) = serde_json::from_str::<Value>(&text) else {
                    continue;
                };
                match v.get("id").and_then(Value::as_u64) {
                    // A reply to one of our commands.
                    Some(id) => {
                        let waiter = pending_reader.lock().unwrap().remove(&id);
                        if let Some(w) = waiter {
                            let _ = w.send(v);
                        }
                    }
                    // An event.
                    None => {
                        if ev_tx.send(v).is_err() {
                            break;
                        }
                    }
                }
            }
        });

        Ok((
            Arc::new(Cdp {
                tx,
                pending,
                next_id: AtomicU64::new(1),
            }),
            ev_rx,
        ))
    }

    async fn call(&self, session: Option<&str>, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let mut msg = json!({ "id": id, "method": method, "params": params });
        if let Some(s) = session {
            msg["sessionId"] = json!(s);
        }

        let (done_tx, done_rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, done_tx);
        self.tx
            .send(msg)
            .map_err(|_| SpikeError::Protocol("connection closed".into()))?;

        let reply = tokio::time::timeout(Duration::from_secs(20), done_rx)
            .await
            .map_err(|_| SpikeError::Protocol(format!("{method} timed out")))?
            .map_err(|_| SpikeError::Protocol(format!("{method} dropped")))?;

        if let Some(err) = reply.get("error") {
            return Err(SpikeError::Protocol(format!("{method}: {err}")));
        }
        Ok(reply.get("result").cloned().unwrap_or(Value::Null))
    }
}

// ---------------------------------------------------------------- observations

const PRE: u8 = 0;
const POST: u8 = 1;

fn phase_name(p: u8) -> &'static str {
    if p == PRE {
        "pre-consent"
    } else {
        "post-consent"
    }
}

#[derive(Serialize, Clone)]
struct Observation {
    seq: u64,
    /// Phase at the moment the request was *initiated*. This is the field that
    /// matters: a request started before consent and finished after it is a
    /// pre-consent request.
    phase: &'static str,
    /// Phase at the moment the response finished, when observed. Present only
    /// to demonstrate that the two can differ.
    completed_phase: Option<&'static str>,
    url: String,
    host: String,
    resource_type: String,
    session: String,
    frame: String,
    action: &'static str,
}

fn host_of(url: &str) -> String {
    let after_scheme = url.split("://").nth(1).unwrap_or(url);
    let authority = after_scheme.split('/').next().unwrap_or("");
    let authority = authority.rsplit('@').next().unwrap_or(authority);
    // Strip a trailing :port, leaving IPv6 literals alone.
    match authority.rfind(':') {
        Some(i) if !authority[i..].contains(']') => authority[..i].to_string(),
        _ => authority.to_string(),
    }
    .trim_start_matches('[')
    .trim_end_matches(']')
    .to_string()
}

fn is_blocked(host: &str, blocked: &[String]) -> bool {
    blocked
        .iter()
        .any(|b| host == b || host.ends_with(&format!(".{b}")))
}

// ----------------------------------------------------------------------- main

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        // F7: a failure the user can read and act on, and a nonzero exit.
        eprintln!("\nSCAN FAILED\n{e}\n");
        std::process::exit(2);
    }
}

fn parse_args() -> Options {
    let mut o = Options {
        url: "http://first.test:8081/".into(),
        blocked: vec![],
        headless: false,
        harden: false,
        proxy: Some("http://127.0.0.1:8080".into()),
        settle_ms: 4000,
        after_consent_ms: 4000,
        consent: true,
    };
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--url" => {
                o.url = args[i + 1].clone();
                i += 1;
            }
            "--block" => {
                o.blocked.push(args[i + 1].clone());
                i += 1;
            }
            "--settle" => {
                o.settle_ms = args[i + 1].parse().unwrap_or(4000);
                i += 1;
            }
            "--after-consent" => {
                o.after_consent_ms = args[i + 1].parse().unwrap_or(4000);
                i += 1;
            }
            "--headless" => o.headless = true,
            "--harden" => o.harden = true,
            "--no-proxy" => o.proxy = None,
            "--no-consent" => o.consent = false,
            other => eprintln!("ignoring unknown argument {other}"),
        }
        i += 1;
    }
    o
}

async fn run() -> Result<()> {
    let o = parse_args();

    let browser_path = find_browser()?;
    println!("browser        {}", browser_path.display());

    let profile = std::env::temp_dir().join(format!("traccia-spike-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&profile);
    std::fs::create_dir_all(&profile).ok();
    println!("profile        {} (ephemeral)", profile.display());

    let flags = launch_flags(&profile, &o);
    let mut child = tokio::process::Command::new(&browser_path)
        .args(&flags)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| SpikeError::LaunchFailed {
            path: browser_path.display().to_string(),
            detail: e.to_string(),
        })?;

    let ws = match wait_for_debug_endpoint(&profile, 15_000, &browser_path.display().to_string())
        .await
    {
        Ok(w) => w,
        Err(e) => {
            let _ = child.kill().await;
            return Err(e);
        }
    };
    println!("devtools       {ws}");
    println!("proxy          {}", o.proxy.clone().unwrap_or("none".into()));
    println!("hardened flags {}", o.harden);
    println!("blocking       {:?}\n", o.blocked);

    let (cdp, mut events) = Cdp::connect(&ws).await?;

    // Auto-attach at the browser level, with new targets paused on arrival.
    // Pausing is what closes the F2 race: an out-of-process iframe would
    // otherwise start issuing requests before its session could be armed.
    cdp.call(
        None,
        "Target.setAutoAttach",
        json!({ "autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true }),
    )
    .await?;

    // Create the page *after* auto-attach is armed, so there is no window in
    // which a target exists unobserved.
    cdp.call(None, "Target.createTarget", json!({ "url": "about:blank" }))
        .await?;

    let phase = Arc::new(AtomicU8::new(PRE));
    let seq = Arc::new(AtomicU64::new(0));
    let observations: Arc<Mutex<Vec<Observation>>> = Arc::new(Mutex::new(Vec::new()));
    // Fetch and Network use different request ids; networkId bridges them so a
    // response can be matched back to the request that started it.
    let by_network_id: Arc<Mutex<HashMap<String, usize>>> = Arc::new(Mutex::new(HashMap::new()));
    let page_session: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    let pump = {
        let cdp = Arc::clone(&cdp);
        let phase = Arc::clone(&phase);
        let seq = Arc::clone(&seq);
        let observations = Arc::clone(&observations);
        let by_network_id = Arc::clone(&by_network_id);
        let page_session = Arc::clone(&page_session);
        let blocked = o.blocked.clone();

        tokio::spawn(async move {
            while let Some(ev) = events.recv().await {
                let method = ev.get("method").and_then(Value::as_str).unwrap_or("");
                let session = ev
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let params = ev.get("params").cloned().unwrap_or(Value::Null);

                match method {
                    "Target.attachedToTarget" => {
                        let sid = params
                            .get("sessionId")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let ttype = params
                            .get("targetInfo")
                            .and_then(|t| t.get("type"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();

                        if ttype == "page" && page_session.lock().unwrap().is_none() {
                            *page_session.lock().unwrap() = Some(sid.clone());
                        }

                        // Arm before resuming. Order is the whole point.
                        let _ = cdp
                            .call(
                                Some(&sid),
                                "Fetch.enable",
                                json!({ "patterns": [{ "urlPattern": "*" }] }),
                            )
                            .await;
                        let _ = cdp.call(Some(&sid), "Network.enable", json!({})).await;
                        // Recurse: this target's own children must be caught too.
                        let _ = cdp
                            .call(
                                Some(&sid),
                                "Target.setAutoAttach",
                                json!({
                                    "autoAttach": true,
                                    "waitForDebuggerOnStart": true,
                                    "flatten": true
                                }),
                            )
                            .await;
                        let _ = cdp
                            .call(Some(&sid), "Runtime.runIfWaitingForDebugger", json!({}))
                            .await;

                        println!("  [attach] {ttype:<10} session={}", &sid[..8.min(sid.len())]);
                    }

                    "Fetch.requestPaused" => {
                        let request_id = params
                            .get("requestId")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let url = params
                            .get("request")
                            .and_then(|r| r.get("url"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let host = host_of(&url);
                        let at = phase.load(Ordering::SeqCst);
                        let block = is_blocked(&host, &blocked);

                        let n = seq.fetch_add(1, Ordering::SeqCst);
                        let obs = Observation {
                            seq: n,
                            phase: phase_name(at),
                            completed_phase: None,
                            url: url.clone(),
                            host: host.clone(),
                            resource_type: params
                                .get("resourceType")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            session: session.clone(),
                            frame: params
                                .get("frameId")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            action: if block { "blocked" } else { "allowed" },
                        };

                        let idx = {
                            let mut v = observations.lock().unwrap();
                            v.push(obs);
                            v.len() - 1
                        };
                        if let Some(nid) = params.get("networkId").and_then(Value::as_str) {
                            by_network_id.lock().unwrap().insert(nid.to_string(), idx);
                        }

                        println!(
                            "  {:<13} {:<6} {}",
                            phase_name(at),
                            if block { "BLOCK" } else { "allow" },
                            url
                        );

                        if block {
                            let _ = cdp
                                .call(
                                    Some(&session),
                                    "Fetch.failRequest",
                                    json!({ "requestId": request_id,
                                            "errorReason": "BlockedByClient" }),
                                )
                                .await;
                        } else {
                            let _ = cdp
                                .call(
                                    Some(&session),
                                    "Fetch.continueRequest",
                                    json!({ "requestId": request_id }),
                                )
                                .await;
                        }
                    }

                    "Network.loadingFinished" | "Network.loadingFailed" => {
                        if let Some(nid) = params.get("requestId").and_then(Value::as_str) {
                            let idx = by_network_id.lock().unwrap().get(nid).copied();
                            if let Some(i) = idx {
                                let at = phase.load(Ordering::SeqCst);
                                observations.lock().unwrap()[i].completed_phase =
                                    Some(phase_name(at));
                            }
                        }
                    }

                    _ => {}
                }
            }
        })
    };

    // Give auto-attach a moment to deliver the page session.
    tokio::time::sleep(Duration::from_millis(800)).await;
    let sid = page_session
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| SpikeError::Protocol("no page target attached".into()))?;

    cdp.call(Some(&sid), "Page.enable", json!({})).await?;
    println!("navigating to  {}\n", o.url);
    cdp.call(Some(&sid), "Page.navigate", json!({ "url": o.url }))
        .await?;

    tokio::time::sleep(Duration::from_millis(o.settle_ms)).await;

    if o.consent {
        // The flag flips *before* the click, so anything the click causes is
        // unambiguously post-consent.
        phase.store(POST, Ordering::SeqCst);
        println!("\n--- consent accepted ---\n");
        let _ = cdp
            .call(
                Some(&sid),
                "Runtime.evaluate",
                json!({
                    "expression": "(document.getElementById('accept')||{click(){}}).click()",
                    "awaitPromise": false
                }),
            )
            .await;
        tokio::time::sleep(Duration::from_millis(o.after_consent_ms)).await;
    }

    // ------------------------------------------------------------- reporting
    let v = observations.lock().unwrap().clone();
    let mut hosts: Vec<String> = v.iter().map(|o| o.host.clone()).collect();
    hosts.sort();
    hosts.dedup();

    println!("\n================ observed ================");
    println!("requests seen           {}", v.len());
    println!("distinct hosts          {}", hosts.len());
    println!(
        "blocked                 {}",
        v.iter().filter(|o| o.action == "blocked").count()
    );
    println!(
        "pre-consent             {}",
        v.iter().filter(|o| o.phase == "pre-consent").count()
    );
    println!(
        "post-consent            {}",
        v.iter().filter(|o| o.phase == "post-consent").count()
    );
    let straddlers: Vec<&Observation> = v
        .iter()
        .filter(|o| o.phase == "pre-consent" && o.completed_phase == Some("post-consent"))
        .collect();
    println!("started pre, ended post {}", straddlers.len());
    for s in &straddlers {
        println!("    {}", s.url);
    }
    println!("\nhosts:");
    for h in &hosts {
        println!("  {h}");
    }

    std::fs::create_dir_all("spike/artifacts").ok();
    std::fs::write(
        "spike/artifacts/observations.json",
        serde_json::to_string_pretty(&v).unwrap(),
    )
    .ok();
    println!("\nwrote spike/artifacts/observations.json");

    pump.abort();
    let _ = child.kill().await;
    let _ = std::fs::remove_dir_all(&profile);
    Ok(())
}
