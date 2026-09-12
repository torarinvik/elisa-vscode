# Contributing to Elisa VS Code

## Repository boundaries

- This repository owns the VS Code client, grammar, packaging, and client-side
  verification.
- The sibling `../Elisa-LSP` repository owns transport, document snapshots, position
  indexing, scheduling, compiler tooling adapters, and semantic features. Coordinate
  protocol or legend changes across both.
- `../Elisa-compiler` owns language semantics. Do not encode language rules by guessing
  in the client.

## Build prerequisites

- Node 18 or newer and npm.
- For server work: macOS or Linux, `clang`, `python3`, and a stage-0 `elisacore`
  compiler. The server development guide is `../Elisa-LSP/docs/development.md`.

## Build outputs

- `npm run compile` type-checks into `out/` and bundles `out/extension.js` into the
  single shipped artifact `dist/extension.js`.
- `npm run watch` runs the same pipeline in watch mode. Do not run `tsc --watch`
  directly; it produces a different runtime artifact shape.
- Source maps are for local debugging only. `.vscodeignore` excludes `out/`, `src/`,
  `test/`, `scripts/`, and all `*.map` files from the VSIX.
- `npm run audit:vsix` enforces the packaged content allowlist.

## Test layers

| Layer | Location | Proves |
| --- | --- | --- |
| Pure unit tests | `test/server-discovery`, `test/lifecycle`, `test/config-health` | Precedence, path edge cases, session state transitions and races, settings validation, report redaction |
| Real grammar tests | `test/grammar-highlighting.test.mjs` + `test/fixtures/highlighting/` | Actual TextMate tokenization through `vscode-textmate` and Oniguruma |
| Manifest and taxonomy tests | `test/semantic-token-manifest.test.mjs` | Standard supertypes, scope mappings, legend order against the server schema |
| Packaging tests | `scripts/smoke/` | VSIX content allowlist; isolated install when a VS Code CLI exists |
| LSP suites | `../Elisa-LSP/test/run_all.sh` | Wire behavior, positions, versions, capabilities |

Run `npm test` before every change. Run `npm run audit:vsix` after packaging changes and
`npm run smoke:vsix` when a VS Code CLI is available.

### Extension-host integration tests

`npm run test:integration` launches VS Code through `@vscode/test-electron` and runs
`integration/suite`, which asserts activation, language registration, command
registration, the semantic legend, and opening an Elisa document. It requires a desktop
session with a working Electron sandbox and no other VS Code instance sharing the
profile; on Linux CI run it under `xvfb-run`. If the host cannot start, the harness
exits after 120 seconds and kills the stray process. It is intentionally separate from
`npm test`, which never launches an editor.

## Fixture conventions

- Highlighting fixtures live in `test/fixtures/highlighting/` as real `.elisa` sources.
- Expectations are written as occurrence-level scope assertions in the test, not as
  regenerated snapshots. A test that only proves an implementation string exists is not
  acceptable.
- Every classifier needs positive and negative cases. Enum fixtures must include real
  families, unrelated PascalCase methods, shadowed locals, conversions, payload types,
  comments, and strings.
- Do not update expectations to match a behavior change without explaining whether the
  change is a language-semantics correction or an intentional presentation change.

## Semantic taxonomy

The canonical legend is `../Elisa-LSP/docs/semantic-token-schema.json`. The client
declares the same ids in the same order in `package.json`; the manifest test fails on
drift or on any supertype outside the VS Code standard set. Custom `elisa.*` types must
justify why a standard category is insufficient and must keep a theme-reachable fallback.

## User-facing text

Manifest strings (display name, command titles, setting labels, descriptions) live in
`package.nls.json` and are referenced from `package.json` as `%key%`. The localization
test fails if a key is undefined, empty, or unused. Runtime notification and dialog text
lives in `src/messages.ts` so it is centralized before a translation workflow exists; do
not add new user-facing literals directly to `extension.ts`.

## Performance harness

Performance work follows the implementation plan's measurement contract: named reference
machine, release profile, warm and cold samples, p50/p95/p99 plus maximum, and
independent `N`, `2N`, `4N` scaling dimensions. Instrumentation stays disabled or cheap
in normal operation. Report measurement context with every performance claim.

## Release checks

1. `npm ci` with a locked dependency tree.
2. `npm run check` and `npm test` on macOS and Linux.
3. `npm run audit:vsix` and `npm run smoke:vsix`.
4. `../Elisa-LSP/test/run_all.sh` against a pinned server build.
5. Confirm `README.md` and capability claims match shipped behavior.
6. Record build identifiers and any known limitations in the release notes.

## Defect classification

Track every defect by the invariant it violated: wrong identity, stale snapshot,
coordinate mismatch, lifecycle leak, unbounded work, unsupported host, or presentation
mapping. Fix the shared cause and add a regression at the lowest layer that can prove
it, plus an end-to-end check when the failure crossed layers. A visible symptom is not
the classification.

## Bug reports

Include: extension version and build identifier (health report), editor host type,
platform, minimal source, expected behavior, actual behavior, exact token or location,
and redacted logs from the Elisa output channel. Source sharing is optional; do not post
proprietary code. Use **Elisa: Collect Support Report** for the environment summary.
