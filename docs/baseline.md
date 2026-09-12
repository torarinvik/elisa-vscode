# Baseline report (M0)

Recorded 2026-09-12 on macOS 26.6.2 (Darwin arm64), Node v26.8.2, npm 11.19.1.

## Repositories

| Repository | Revision at baseline | Working tree |
| --- | --- | --- |
| `elisa-vscode` | `7bd3098` (Bootstrap Elisa VS Code extension) | Plan implementation in progress |
| `Elisa-LSP` | `5edc28f` | Modified `src/diagnostics.elisa`, `src/main.elisa`; untracked `IMPLEMENTATION_PLAN.md` |

Compiler toolchain: stage-0 `elisacore` at `~/.elisac/elisac-stage0`; frontend revision
`feb86d4d0ca1`; Homebrew clang 23.1.1; server build profile release `-O2`.

Build commands used:

```sh
npm run compile      # tsc + esbuild bundle
npm test             # compile, then node --test
npm run audit:vsix   # vsce content audit
npm run smoke:vsix   # package + isolated install when a VS Code CLI exists
cd ../Elisa-LSP && bash build.sh && bash test/run_all.sh
```

## Results before this plan's implementation

- `elisa-vscode`: `npm run check` passed; `node --test` ran **2 manifest tests**, both
  passing. The tests asserted that strings existed in `package.json` and in the grammar,
  not that real tokenization produced the right scopes.
- `Elisa-LSP`: freshly built server; `test/run_all.sh` ran **19 suites, 19 passed, 0
  failed** (protocol, capabilities, documents, sync, positions, diagnostics versions,
  semantic tokens, hover, URIs, numerics, escapes, manifest).

## Results after the first implementation pass

- `elisa-vscode`: **55 tests passing**, including real TextMate tokenization through
  `vscode-textmate` and `vscode-oniguruma`, discovery precedence, lifecycle races,
  configuration classification, and health-report redaction.
- `npm run audit:vsix`: 6 packaged entries, no leaked build inputs or source maps.
- `npm run smoke:vsix`: VSIX packaged successfully; isolated install **skipped with
  reason** because no VS Code CLI (`code`) was available on this machine. Set
  `VSCODE_BIN` or install the CLI to run the install step.

## Explicit gaps

- Installed-VSIX activation and theme behavior are not verified on this machine (no VS
  Code CLI); the harness exists and reports the skip.
- Performance baselines from section 5 of the implementation plan are not yet measured;
  no named reference machine has been frozen.
- Windows, remote, and web support are unverified and must not be advertised.
- The sibling server owns transport, position indexing, scheduling, and semantic
  feature work; this report covers only the extension-side baseline.

No behavior is reported as verified merely because a source pattern or a manifest
string exists.
