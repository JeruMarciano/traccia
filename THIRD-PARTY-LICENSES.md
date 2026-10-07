# Third-party licenses

Traccia itself is MIT-licensed (see [LICENSE](LICENSE)). It is built on open-source
libraries, almost all of them under MIT, Apache-2.0, BSD or ISC licenses.

## MPL-2.0 components in the shipped app

Six components in the shipped app are licensed under the Mozilla Public License 2.0: five
Rust crates and `@duckduckgo/autoconsent`. MPL-2.0 is a file-level license: its
source-availability obligation covers those files themselves, which are available, unmodified,
at their upstream repositories.

### Five Rust crates

None was chosen directly: all arrive transitively through the [Tauri](https://tauri.app)
framework, and none is modified:

| Crate | Reached via | Source |
|---|---|---|
| `cssparser` | tauri-utils | https://github.com/servo/rust-cssparser |
| `cssparser-macros` | tauri-utils | https://github.com/servo/rust-cssparser |
| `selectors` | tauri-utils | https://github.com/servo/stylo |
| `dtoa-short` | tauri-utils | https://github.com/upsuper/dtoa-short |
| `option-ext` | tauri → dirs | https://github.com/soc/option-ext |

This list was produced by a license sweep of the full dependency tree
(`cargo tree --format "{p}|{l}"`, 2026-08-02); no GPL, LGPL, AGPL, CDDL, EPL or SSPL
license string appears anywhere in the tree.

### `@duckduckgo/autoconsent` 16.43.0

Chosen directly. Two of its files ship unmodified, vendored in `src-tauri/vendor/autoconsent/`
(see `SOURCE.md` there for the tarball URL and sha256 of each):

| File | From the package | sha256 |
|---|---|---|
| `autoconsent.playwright.js` (the engine) | `dist/autoconsent.playwright.js` | `67fcab16c5e7bf81f51cd39c8398438ab7c00e9be527c93ef8b9376d2cabddb5` |
| `rules.json` (the rules; the full file, not `compact-rules.json`) | `rules/rules.json` | `0b03adbbfa838c4fd8d6c17357729f9e21ce285c0f8518f9ab476fc6d332edc9` |

License: MPL-2.0 (copy in `src-tauri/vendor/autoconsent/LICENSE`). Source:
https://github.com/duckduckgo/autoconsent . Why: it executes the consent-manager rules, and
there is no rules-only path. `tests/build/vendorUnmodified.test.ts` fails if a byte of either
vendored file changes.

## The Open Cookie Database

`src/data/cookie-platforms.json` is derived from the
[Open Cookie Database](https://github.com/jkwakman/Open-Cookie-Database) (Apache-2.0), upstream
commit `749c37c17eb910fa95621f4fee34d9a6d4126c23` (749c37c). It is a modified, slimmed
derivative: `scripts/slim-open-cookie-database.mjs` reduces the upstream CSV to four fields
per cookie (name, platform, category, wildcard flag), so a cookie name maps to the platform
that sets it and its category; all other columns are dropped. This notice states that change
as Apache-2.0 section 4 requires. The upstream license follows verbatim in
[NOTICE-open-cookie-database.txt](NOTICE-open-cookie-database.txt).

## Build-time only (not distributed)

`lightningcss` (MPL-2.0) is used by the build tooling (Vite) to process CSS at build
time. It is not part of the shipped application and nothing of it is conveyed.

## The vendor dictionary

The vendor dictionary in `src/data/vendors.json` is hand-authored for this project and
carries Traccia's own MIT license. It is not derived from any third-party tracker list.
