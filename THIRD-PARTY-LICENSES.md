# Third-party licenses

Traccia itself is MIT-licensed (see [LICENSE](LICENSE)). It is built on open-source
libraries, almost all of them under MIT, Apache-2.0, BSD or ISC licenses.

## MPL-2.0 components in the shipped app

Five Rust crates in the shipped binary are licensed under the Mozilla Public License 2.0.
None was chosen directly: all arrive transitively through the [Tauri](https://tauri.app)
framework, and none is modified. MPL-2.0 is a file-level license: its source-availability
obligation covers those files themselves, which are available, unmodified, at their
upstream repositories:

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

## Build-time only (not distributed)

`lightningcss` (MPL-2.0) is used by the build tooling (Vite) to process CSS at build
time. It is not part of the shipped application and nothing of it is conveyed.

## The vendor dictionary

The vendor dictionary in `src/data/vendors.json` is hand-authored for this project and
carries Traccia's own MIT license. It is not derived from any third-party tracker list.
