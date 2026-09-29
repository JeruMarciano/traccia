//! The autoconsent bridge, pure half: the vendored engine and rules, the fixed expressions Rust
//! sends into the isolated world, and the filters every engine message passes before `cdp.rs`
//! acts on it (spec §5.2, §5.3).
//!
//! The engine runs unmodified in an isolated world named [`WORLD`]. It talks to Rust only through
//! the CDP binding [`BINDING`], which exists in worlds of that name and never in the page's own, so
//! a page cannot forge a message. Messages are still parsed as hostile: an unknown type, a bad
//! shape or an oversized field is dropped, and a CMP name counts only if the shipped engine or
//! rules carry it as a quoted string literal.

pub const ENGINE: &str = include_str!("../vendor/autoconsent/autoconsent.playwright.js");
pub const RULES: &str = include_str!("../vendor/autoconsent/compact-rules.json");
pub const WORLD: &str = "traccia-consent";
pub const BINDING: &str = "tracciaConsent";
/// Installed before ENGINE in the isolated world. A CDP binding takes exactly one string.
pub const SHIM: &str = "window.autoconsentSendMessage = (m) => { try { tracciaConsent(JSON.stringify(m).slice(0, 8192)) } catch (e) {} }";
/// `autoAction: null` so the engine waits for Rust's `optIn`; prehide and cosmetic rules off,
/// because hiding a banner is not a consent click.
pub const CONFIG: &str = r#"{"enabled":true,"autoAction":null,"disabledCmps":[],"enablePrehide":false,"enableCosmeticRules":false,"enableGeneratedRules":true,"enableHeuristicDetection":false,"detectRetries":20,"logs":{"lifecycle":false,"rulesteps":false,"detectionsteps":false,"evals":false,"errors":false,"messages":false,"waits":false}}"#;

/// The longest eval `code` relayed to the page's main world.
const MAX_CODE: usize = 8192;

/// What the scan did about consent. Task 6 adds the click.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Consent {
    pub cmp: Option<String>,
    pub clicked: bool,
    /// "no-banner" | "no-button"; `None` when detection did not run to its end.
    pub reason: Option<&'static str>,
}

#[derive(Debug, PartialEq)]
pub enum EngineMsg {
    Init,
    CmpDetected(String),
    PopupFound(String),
    OptInResult(bool),
    Eval { id: String, code: String },
    Done,
    Error,
}

/// One binding payload. Unknown types, bad shapes, ids not [A-Za-z0-9.-]{1,64}, code over 8 KB → None.
///
/// The brief's id rule was [A-Za-z0-9]{1,64}; the engine's ids are `crypto.randomUUID()` (with
/// `-`) or, where that does not exist, `Math.random().toString()` (with `.`). Neither character
/// can end the quoted string [`eval_reply`] puts the id in.
pub fn parse_engine_msg(payload: &str) -> Option<EngineMsg> {
    let msg: serde_json::Value = serde_json::from_str(payload).ok()?;
    let text = |key: &str| msg.get(key)?.as_str().map(str::to_string);
    Some(match msg.get("type")?.as_str()? {
        "init" => EngineMsg::Init,
        "cmpDetected" => EngineMsg::CmpDetected(text("cmp")?),
        "popupFound" => EngineMsg::PopupFound(text("cmp")?),
        "optInResult" => EngineMsg::OptInResult(msg.get("result")?.as_bool()?),
        "eval" => {
            let id = text("id")?;
            let code = text("code")?;
            let id_ok = (1..=64).contains(&id.len())
                && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.');
            if !id_ok || code.len() > MAX_CODE {
                return None;
            }
            EngineMsg::Eval { id, code }
        }
        "autoconsentDone" => EngineMsg::Done,
        "autoconsentError" => EngineMsg::Error,
        _ => return None,
    })
}

/// Some(name) only when it matches [A-Za-z0-9 ._-]{1,64} and `"name"` appears literally in ENGINE or RULES.
pub fn known_cmp(name: &str) -> Option<String> {
    let shaped = (1..=64).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b' ' | b'.' | b'_' | b'-'));
    let quoted = format!("\"{name}\"");
    (shaped && (ENGINE.contains(&quoted) || RULES.contains(&quoted))).then(|| name.to_string())
}

/// autoconsentReceiveMessage({type:'initResp', config: CONFIG, rules: {compact: RULES}}) — built from consts only.
pub fn init_reply() -> String {
    format!("autoconsentReceiveMessage({{type:'initResp', config: {CONFIG}, rules: {{compact: {RULES}}}}})")
}

/// `id` already validated by [`parse_engine_msg`].
pub fn eval_reply(id: &str, result: bool) -> String {
    format!("autoconsentReceiveMessage({{type:'evalResp', id:'{id}', result:{result}}})")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_message_types_are_dropped() {
        assert!(parse_engine_msg(r#"{"type":"report","state":{}}"#).is_none());
        assert!(parse_engine_msg(r#"{"type":"evalResp","id":"a","result":true}"#).is_none());
        assert!(parse_engine_msg("not json").is_none());
    }

    #[test]
    fn an_eval_request_keeps_its_id_and_code_within_bounds() {
        assert!(matches!(
            parse_engine_msg(r#"{"type":"eval","id":"abc123","code":"!!window.x"}"#),
            Some(EngineMsg::Eval { .. })
        ));
        assert!(parse_engine_msg(r#"{"type":"eval","id":"a\"b","code":"1"}"#).is_none());
        assert!(parse_engine_msg(&format!(
            r#"{{"type":"eval","id":"a","code":"{}"}}"#,
            "x".repeat(9000)
        ))
        .is_none());
        // The engine's own ids: `crypto.randomUUID()` on https, `Math.random().toString()` on
        // http, where `randomUUID` does not exist.
        for id in ["3b241101-e2bb-4255-8caf-4136c566a962", "0.8364195520128395"] {
            let msg = format!(r#"{{"type":"eval","id":"{id}","code":"1"}}"#);
            assert!(matches!(parse_engine_msg(&msg), Some(EngineMsg::Eval { .. })), "{id}");
        }
    }

    #[test]
    fn only_names_shipped_in_the_engine_or_rules_pass() {
        assert_eq!(known_cmp("iubenda").as_deref(), Some("iubenda"));
        assert_eq!(known_cmp("Cybotcookiebot").as_deref(), Some("Cybotcookiebot"));
        assert!(known_cmp("Evil Corp CMP").is_none());
        assert!(known_cmp("iubenda\"<script>").is_none());
    }
}
