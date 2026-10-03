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

- `elisa-vscode`: **55 tests passing** at the first commit, growing to **69** with
  compatibility checks, seeded grammar fuzzing, hostile-input bounds, a 200-cycle soak,
  and a compiler-backed enum golden test. Coverage includes real TextMate tokenization
  through `vscode-textmate` and `vscode-oniguruma`, discovery precedence, lifecycle
  races, configuration classification, taxonomy validation, and health-report redaction.
- `npm run audit:vsix`: 6 packaged entries, no leaked build inputs or source maps.
- `npm run smoke:vsix`: VSIX packaged and installed into an isolated profile using the
  VS Code CLI bundled with the installed app, then verified to contain the compiled
  bundle and grammar. The extension-host integration suite (`npm run test:integration`)
  is provided but could not run in this headless shell because Electron could not start
  its network service; run it from a desktop session or CI with a display.

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

## Revalidation (2026-09-13)

Environment: macOS Darwin/arm64, Node v26.8.2. The extension worktree was clean at
revision `bdbab60` before this record was added. The Elisa-LSP and Elisa-compiler
worktrees already contained extensive uncommitted changes; those changes were left
untouched.

- `npm test` before adding the sibling-binary freshness guard: **87 passed, 0 failed**.
  That run included actual TextMate tokenization, semantic-token requests against the
  pre-existing sibling executable, hostile-input checks, discovery/session tests, and
  restart-soak checks. The semantic test was then corrected to reject stale-binary
  evidence.
- `npm test` with the freshness guard: **86 passed, 1 skipped, 0 failed**. The semantic
  golden test now skips because current LSP source is newer than its executable; the
  skip is the correct result until a fresh server can be built.
- `npm run check`: passed.
- `npm run audit:vsix`: passed; 17 packaged entries, with no source/build-input leaks.
- `npm run smoke:vsix`: passed; VS Code CLI installed the VSIX into isolated extension
  and user-data directories, and the unpacked package contained its manifest, bundle,
  and grammar. This proves packaging and installation, not editor-host activation or
  rendered theme colors.
- `npm run bench`: completed. The extension grammar and discovery samples are captured
  in `benchmarks/2026-09-13-macos-arm64.json`. They are observational samples on this
  machine, not release gates. Server measurements in that capture used the pre-existing
  LSP executable and are explicitly marked stale relative to current LSP source.
- `npm run test:integration`: attempted, then stopped after Electron repeatedly crashed
  its network service. The extension-host suite did not complete; this is not a pass.
  The runner now uses isolated temporary workspace, user-data, and extension directories,
  caps captured output at 64 KiB, times out after 60 seconds, and cleans up in `finally`.
  The final run observed about 2.3 MB of repeated Electron crash output before timing
  out (the first bounded run captured about 4.1 MB); a stable desktop/CI execution
  environment is still needed for host-behavior evidence.
- `cd ../Elisa-LSP && bash test/run_all.sh`: did not run the suite because its fresh-binary
  gate correctly rejected the existing executable as older than `src/`.
- `cd ../Elisa-LSP && bash build.sh`: failed while the available stage-0 compiler parsed
  changed Elisa-compiler sources, including the new protocol-parameter parser. The build
  produced no fresh server, so the modified LSP state remains unverified. Do not use the
  existing executable's benchmark or semantic tests as evidence for those unbuilt edits.

The prior `Explicit gaps` list above is the 2026-09-12 snapshot. This revalidation
supersedes its VS Code CLI/package and measured-client-performance entries; actual
extension-host activation, visual theme behavior, fresh LSP tests, memory-retention
soak, and broader platform/remote support remain open.

## Markdown fenced-code lexical support (2026-09-14)

The earlier Markdown-fence gap is now addressed for lexical highlighting: the VS Code
package injects the real Elisa TextMate grammar into top-level backtick or tilde fences
of three or more markers labeled `elisa`, with optional info-string metadata and
case-insensitive language labels. Tests exercise the injection against the installed
VS Code Markdown grammar and a small host-grammar fixture, including non-Elisa fences,
unrelated inline code, longer closing fences, and nested
fence-looking lines in another code block. VSIX auditing requires the injection grammar
to be packaged.

This does not enable language-server features in Markdown. The client still selects only
Elisa-language documents, by design, so diagnostics and semantic tokens cannot be
incorrectly computed over the Markdown wrapper. Actual VS Code host token inspection for
Markdown remains a desktop/integration verification item.

## Fresh-snapshot validation after compiler update (2026-09-13)

The updated stage-0 compiler successfully built Elisa-LSP release `-O2` from the then-
stable source snapshot. The resulting artifact SHA-256 was
`9223e03bc7a949708b726d15c4abef547b60b91befa49e42b221e7530b5b617e`; its manifest
recorded LSP input fingerprint
`d204bb6f8d96b257068415ef15985cd14f34b74786bfaaff4b6a242583586f1c` and compiler-source
fingerprint
`cd4500d39e91cd7bb5a6fd33cda6f4bd16b0715c2fd4e95ae30441ffbd2c35aa`.

- `bash ../Elisa-LSP/test/run_all.sh`: **39 passed, 0 failed** against that artifact,
  including transport/framing, cancellation, strict and differential JSON, semantic
  tokens, definitions, positions, incremental sync, diagnostics, storage reclamation,
  frontend contracts, and the manifest.
- `npm test`: **87 passed, 0 failed, 0 skipped** against the same artifact. The semantic
  golden includes `return Event.Resize(1)` and verifies that `Event` receives its user-
  type semantic token while `Resize` receives the dedicated enum-variant token.
- Later, `test/semantic-golden.test.mjs` was strengthened to compare the server binary
  checksum and both LSP/compiler source fingerprints with `build/manifest.json`. Its
  helper tests passed. The subsequent `npm test` had **87 passed, 0 failed, 1 skipped**:
  the skip is correct because LSP sources changed after the validated snapshot.
- The benchmark harness now sends the server's required `initialize` capabilities shape
  and reports build provenance. The exact binary benchmark is retained in
  `benchmarks/2026-09-13-macos-arm64.json`; it is not represented as performance evidence
  for the newer LSP checkout.
- `npm run check`, JavaScript syntax checks, and `git diff --check` passed.
- At that earlier snapshot, the LSP source tree no longer matched its manifest input
  fingerprint. The current status is superseded by the following fresh-build record.

The failed Electron extension-host attempt documented above is still unresolved; static,
unit, subprocess, and installed-VSIX checks do not substitute for real host activation or
theme inspection.

## Superseded snapshot validation after analysis/performance updates (2026-09-13)

The current Elisa-LSP sources were rebuilt in release `-O2` after diagnostic line-index
reuse and frontend-analysis counters landed. Build provenance at measurement time:

- Built at UTC: `2026-09-13T19:30:28Z`.
- LSP input fingerprint: `f3b19aacd6216a4747cc579a443c40f1d2458b9092c5c1a0de753395bcbf75ef`.
- Compiler source fingerprint: `7b5729b5341eeef652a9b63ff0a47562afdef0baf14f160d595ac949717a2f0b`.
- Server artifact SHA-256: `768dab6a45a3947e2ebd3b3b4fe261da79d76b6f0cf62547452913f534347820`.
- The extension freshness check confirmed that the manifest's artifact and both source
  fingerprints matched the live build inputs during this validation.

- `bash ../Elisa-LSP/test/run_all.sh`: **43 passed, 0 failed**, including strict/bounded
  transport and JSON, cancellation, diagnostics, cache reuse, definitions/references,
  lifecycle, reclamation, frontend contract, and 9,596 exhaustive short byte-string
  position cases. The protocol fixture's initial run exposed a test-only ID collision
  (`92` was both an ignored response and a deliberately invalid request); after assigning
  distinct IDs, the protocol test and full suite passed.
- `npm test`: **88 passed, 0 failed, 0 skipped** against the matching release snapshot.
  This includes the `Event.Resize(1)` golden: the enum family receives the user-type token
  while the constructor variant receives the enum-member token.
- `npm run bench`: the current binary's server measurements and extension grammar and
  discovery samples are recorded in `benchmarks/2026-09-13-macos-arm64.json`. They remain
  observational, not release gates. The semantic-token p99/max outlier is retained in
  `docs/performance.md` for cold-versus-warm profiling.
- Extension-host integration remains unverified: the prior attempt was stopped after
  repeated Electron network-service crashes. Static/unit/subprocess and installed-VSIX
  checks do not substitute for real host activation or rendered theme inspection.

The Elisa-LSP worktree contained uncommitted changes during this snapshot, so the build
manifest is the authoritative identity of the tested input set. Rebuild and rerun the
gates after any relevant Elisa-LSP or Elisa-compiler source edit.

## Current snapshot validation after strict parameter checks (2026-09-13)

The compiler fix successfully built the latest Elisa-LSP source tree. The source
fingerprint remained stable through the build and full LSP suite; the extension-side
provenance check also confirmed the binary, LSP inputs, and compiler inputs match.

- Built at UTC: `2026-09-13T20:15:53Z`, release `-O2`.
- LSP input fingerprint: `cf5df770ffae02a77b4d5e60719e591968ec5406102e745d61a82a5947a9b884`.
- Compiler source fingerprint: `7b5729b5341eeef652a9b63ff0a47562afdef0baf14f160d595ac949717a2f0b`.
- Server artifact SHA-256: `da15ffa5739d1871814361061dbe20b203f280ad149adf875cb9ec1e4b9cffb3`.

- `bash ../Elisa-LSP/test/run_all.sh`: **44 passed, 0 failed**. Coverage includes strict
  framing/transport and JSON, malformed numeric fields, enum/type semantic tokens,
  definitions/references/highlights, versioned diagnostics, incremental sync, cache reuse,
  storage reclamation, URI/position correctness, the build source-mutation guard, and
  9,596 exhaustive short-byte-string position cases.
- Numeric request tests distinguish malformed hover positions, which must return
  `InvalidParams` without coercion, from valid positions outside the document, which
  correctly return a null result.
- `npm test`: **88 passed, 0 failed, 0 skipped** against that exact server binary;
  `npm run check` and Elisa-LSP `git diff --check` passed.
- Extension-host integration remains unverified because the earlier Electron host run
  repeatedly crashed its network service. Packaging, subprocess, unit, and semantic-golden
  tests do not substitute for real editor-host/theme verification.

The previous performance capture belongs to an earlier server snapshot and is retained
with its exact provenance. It must not be attributed to this build; a fresh measurement
for this exact binary is pending.

## Fresh actual-compiler snapshot (2026-09-14)

Elisa-LSP was rebuilt in release `-O2` against the adjacent Elisa-compiler checkout at
clean commit `9791a8e1cd924bb03e43cb46da2d3530b4c9fbb0`. The stage-0 compiler SHA-256 is
`5a768c38f9144a4ce894c7c0bf904fe408eef79f4cd6ae7bee8c34cf4d49b206`; compiler-source
fingerprint is `9177f9916409f210a619ad31e892ab3f21f7bacd78e2b9e6dc00745ee2a7c3d2`; LSP
input fingerprint is `af48fb0c2696889f6304dbe97f298068ccac11eb966e0f8bdbbd92c83ace9041`;
the release server SHA-256 is
`20b2ae3066952dc9ea7fdafff325d132fe8292445ee6ec1aa912fb207a1905bf` (built
`2026-09-14T06:40:32Z`). The source freshness check passed against the live checkouts.

- `bash ../Elisa-LSP/test/run_all.sh`: **54 passed, 0 failed**. It includes strict and
  bounded transport/JSON, all advertised providers, recovery from malformed source and
  invalid analysis results, worker crash/timeout/packet fault injection, forced URI
  collisions, and storage/sidecar reclamation. The storage soak ended at 0 logical live
  bytes and 558,912 bytes of retained byte-store capacity.
- `test/positions_test.sh` preserves the complete 9,596-case generated matrix and Python
  oracle, including span/padded-index coverage. Its output is now buffered in bounded
  chunks; the exhaustive probe completed in about 6.4 seconds instead of timing out after
  90 seconds. No cases or comparisons were removed.
- The first canonical run had one URI-collision server initialization timeout; the
  isolated rerun and subsequent complete canonical rerun both passed with the original
  10-second startup bound. Record as a non-reproduced startup flake, not a passing first
  attempt or a demonstrated product defect.
- `npm test`: **88 passed, 0 failed, 0 skipped**; compiler-backed enum-family golden ran
  against the fresh server. `npm run check` and `git diff --check` passed.
- `node scripts/bench.mjs` produced `benchmarks/2026-09-14-macos-arm64.json` from this
  exact fingerprint-matched server. For its 750-line workload, server-start-plus-
  initialize p50 was 2.205 ms, semantic-token p50/p95/p99 was 0.238/0.331/0.399 ms, and
  hover was 0.111/0.185/0.200 ms. The 2,500-to-10,000-line grammar p50 scaled 4.45× for
  4× input. This is one observational run, not a regression gate; analysis reported
  65,447 adapter queries, whose cost is not isolated by this harness.
- Elisa fences inside Markdown are **not supported yet**: the package contributes the
  `source.elisa` grammar to the standalone `elisa` language only and has no Markdown
  injection grammar; the language client also selects documents by Elisa language ID,
  not Markdown host documents. No Markdown-fence support is implied by this validation.
- The compiler checkout is clean, but Elisa-LSP has uncommitted changes. The build emits
  existing non-fatal optimizer/effect warnings. Real VS Code extension-host activation,
  rendered theme behavior, Linux validation, and Windows/remote support remain open.

## Fresh current-source validation (2026-09-14)

After the preceding snapshot, the compiler source tree had changed relative to the
recorded LSP artifact, so its compiler-backed extension golden correctly skipped. The
current Elisa-LSP was rebuilt in release `-O2` against the clean adjacent
Elisa-compiler checkout and revalidated before accepting any semantic test result.

- Built at UTC: `2026-09-14T07:48:39Z`.
- Elisa-compiler revision: `9791a8e1cd924bb03e43cb46da2d3530b4c9fbb0`; compiler-source
  fingerprint: `9177f9916409f210a619ad31e892ab3f21f7bacd78e2b9e6dc00745ee2a7c3d2`.
- Elisa-LSP input fingerprint: `6a9a49600c70694457c22e966c5045d6ff970a2a5470202899d6e4ade8c5cb4d`.
- Stage-0 compiler SHA-256: `f8287a9c3ed3ec85470a0497690b85c6818fa26327c5d3cfdf9c76402639f6e4`.
- Server artifact SHA-256: `9cc7ffad3a8bf6ede81856b382bbc52f36e3809252603560e123e4b71130d52e`.
- Elisa-LSP build provenance and live input freshness check matched; its checkout is
  dirty, and the manifest captures that exact input fingerprint. The compiler checkout
  is clean.
- `bash ../Elisa-LSP/test/run_all.sh`: **55 passed, 0 failed**, including strict
  transport/JSON bounds, all advertised semantic providers, recovery and worker fault
  isolation, URI collision handling, storage reclamation/churn, and the 9,596-case
  position matrix. Frontend-contract and build-manifest checks also passed.
- `npm test`: **94 passed, 0 failed, 0 skipped**. This includes the compiler-backed
  enum-family/variant golden against the fresh artifact and Markdown-fence tokenization
  composed with the installed VS Code Markdown grammar.
- `npm run check`, `git diff --check`, and `npm run audit:vsix` passed. The VSIX audit
  found 18 packaged entries and no leaked build inputs; `npm run smoke:vsix` installed
  the package into an isolated VS Code profile and verified both grammar files.
- `npm run test:integration` passed on stable VS Code 1.137.0. It packages the extension,
  installs that VSIX in an isolated profile, and asserts from the extension host that
  the loaded extension path is the installed VSIX rather than the development checkout.
  It also verifies activation, contributed commands/language, Markdown injection
  metadata, and that an Elisa-fenced document retains its Markdown host language ID.
  The first attempt against Insiders timed out while Chromium's network service crashed
  repeatedly; the harness now prefers the installed stable `Code` executable and also
  accepts an explicit `VSCODE_BIN`/`VSCODE_CLI`.
- Elisa fences support lexical syntax highlighting only. Markdown host text is not
  passed to the LSP, so semantic tokens, diagnostics, hover, and navigation remain
  standalone-`.elisa` features. Actual extension-host activation and rendered theme
  behavior across light, dark, and high-contrast themes remain open. One current stable
  host has now exercised the installed artifact, but that is not a theme/platform matrix.

The release build emitted the compiler's existing non-fatal optimizer/effect warnings.
This evidence is a point-in-time snapshot: rerun build freshness and both suites after
any relevant source changes.

## Environment-based server discovery regression (2026-09-14)

The discovery precedence tests exposed that a valid `ELISA_LSP` path was probed as an
explicit candidate but then discarded; resolution continued only through nearby and
`PATH` candidates and could incorrectly report that no server existed. Valid explicit
setting and environment candidates now both return immediately in precedence order.
A regression test verifies the environment candidate wins and that no automatic
filesystem probes run after it succeeds.

- `npm test`: **93 passed, 0 failed, 2 skipped**. The compiler-backed semantic golden
  skipped because current Elisa-LSP and Elisa-compiler inputs differ from the built
  artifact; the optional installed-Markdown-grammar composition test skipped because
  that grammar was not available in this test environment.
- `npm run check` and `git diff --check` passed.

The stable VS Code installation's own Markdown TextMate grammar was then supplied to the
composition test (`VSCode 1.137.0`): **94 passed, 0 failed, 1 skipped**. The only skip is
the compiler-backed semantic golden because the available server build does not match
current compiler sources. `npm run audit:vsix` also passed with 18 packaged entries and
no leaked build inputs.

This client-only change does not validate the currently changing sibling LSP checkout.
Rebuild and rerun the server-dependent checks once its active implementation pass has
settled.

## Health-report configuration privacy (2026-09-14)

Multi-root setting-divergence warnings previously included the literal distinct setting
values. Since executable settings can be absolute paths outside the home directory, the
home-only path redaction in health reports did not guarantee those values were hidden.
Warnings now report the setting and its first-folder behavior without including folder
paths or configured values; a regression test asserts those values are absent.

- `npm test`: **93 passed, 0 failed, 2 skipped** before supplying the real Markdown host
  grammar; rerun with VS Code 1.137.0's installed grammar: **94 passed, 0 failed, 1
  skipped**. The sole remaining skip is the compiler-backed golden because the installed
  LSP artifact does not match the current compiler source fingerprint.
- `npm run check` and `git diff --check` passed.
- `npm run audit:vsix`: passed (18 packaged entries, no leaked build inputs).
- `npm run smoke:vsix`: passed; the isolated VS Code CLI installation unpacked both Elisa
  and Markdown grammars from the packaged extension.

## Bounded Markdown grammar behavior (2026-09-14)

Added an adversarial performance regression for malformed oversized fence labels,
long delimiter runs, and 2,000 lines inside an unterminated Elisa tilde fence. The test
tokenized the complete input in 8.5 ms in this run (10-second generous completion bound);
this is a boundedness check, not a performance target or cross-machine benchmark.

- `npm test` with the installed VS Code 1.137.0 Markdown grammar: **95 passed, 0 failed,
  1 skipped**. The compiler-backed semantic golden is the only skip because the available
  LSP artifact does not match current compiler sources.
- `npm run check` and `git diff --check` passed.
- `npm run test:integration`: passed against stable VS Code 1.137.0 with the installed
  VSIX in isolated workspace, user-data, and extension directories.

## Bounded benchmark protocol and Markdown scaling (2026-09-14)

The LSP benchmark client now applies request and frame limits, bounds retained stderr,
rejects pending requests promptly on child exit, and uses TERM/KILL shutdown escalation.
The benchmark skips an LSP artifact unless its checksum and both source fingerprints
match the live inputs; it no longer reports timings from a known-stale server.
Subprocess regressions cover normal framing, premature exit, silent timeout, oversized
output, malformed JSON, spawn failure, and cleanup.

- `npm test` with the installed VS Code 1.137.0 Markdown grammar: **100 passed, 0 failed,
  1 skipped**. The only skip is the compiler-backed semantic golden because the sibling
  LSP artifact was built against a different compiler source snapshot.
- `npm run check` passed. `npm run bench -- --out
  benchmarks/2026-09-14-markdown-fences-macos-arm64.json` completed and captured
  stand-alone and Markdown-fence scaling; the 1,254-to-5,004-line Markdown p50 grew
  4.09× for 3.99× input. The server section correctly reports unavailable for stale
  source fingerprints instead of launching that binary.
- `npm run test:integration` passed against the installed VSIX in stable VS Code 1.137.0.

Compiler diagnostic during this pass: the compiler source checkout is clean at
`9791a8e`, but its `bin/elisac-stage1` product predates
`src/driver/elisac.elisa`. The direct stage1 wrapper refuses to run it as stale (exit 2).
The driver-acceptance parity harness hides that guard output and miscounts the setup
failure as 202 compiler rejection disagreements. The full gate was stopped after this
precondition was proven; this is a compiler-test harness false positive, **not evidence
of a compiler semantic defect**. No compiler source was modified, and a current stage1
build plus a full parity rerun is still needed before claiming compiler verification.

Separate known compiler gap: the current compiler README still lists generic/aggregate
error-union value propagation as not yet ported. The concrete probe
`../Elisa-compiler/test/repro/generic_error_union_propagation.elisa` is accepted by the
stage0 semantic oracle; its fixture comment specifies the intended native result, 43.
I did not run it through the stage1 product because the stale-artifact guard correctly
refused that binary. This is an open compiler feature gap with a valid probe, but not yet
an observed stage1 miscompile.

## Restricted configuration and semantic-token manifest repair (2026-09-14)

The installed VS Code host reported schema warnings for the semantic-token contributions:
all 48 custom IDs used dots although the contribution schema permits alphanumeric,
hyphen, and underscore characters, and most TextMate fallback scopes were scalar strings
instead of arrays. This invalidated the intended theme fallbacks and could explain missing
semantic colors. IDs are now valid `elisa-*` identifiers, every scope mapping is an array,
and legacy dotted wire names retain identical scope mappings. Legend comparison accepts
the legacy spelling only when it maps exactly to a declared type and retains order checks.

Workspace trust review found a second configuration risk: `machine-overridable` settings
can be set by a workspace, so a repository could select an executable through
`elisa.languageServer.path` or turn on source-bearing protocol traces. The extension now
declares limited Restricted Mode support and both settings as restricted configurations,
retains a client-side user/global-only selection fallback, writes configured executables
to user settings while untrusted, and refreshes effective settings when trust is granted.

- `npm test`, `npm run check`, and `git diff --check` passed.
- `npm run test:integration` passed against the packaged VSIX in VS Code 1.137.0; its
  captured host output had none of the semantic-token schema warnings. `npm run audit:vsix`
  passed (18 entries, no leaked build inputs), and `npm run smoke:vsix` unpacked both
  grammars successfully.
- At the time of this manifest repair, the integration helper forcibly disabled Workspace
  Trust, so it did not verify runtime behavior in Restricted Mode. That evidence gap was
  closed by the later **Installed VSIX Restricted Mode verification** entry below.

## Installed VSIX live-client lifecycle (2026-09-14)

The packaged-host integration now injects a test-only Elisa LSP executable via the same
`ELISA_LSP` discovery path a user can configure. The VS Code extension host starts it
through `LanguageClient` (not a test-side protocol shortcut). The test server implements
only the protocol surface needed by this integration: initialize, document sync,
semantic tokens, hover, shutdown, and exit. Its semantic tokens are derived from the
opened document and cover the enum family declaration, variant declarations, and
qualified family/variant references.

- `npm test`: **108 passed, 0 failed, 2 skipped** (110 total); one skip is the stale
  compiler-backed semantic golden, and one is the standalone optional Markdown-host test.
- `npm run test:integration`: passed in installed stable VS Code 1.137.0. It verified
  server initialization, `ELISA_LSP` provenance, server identity/capabilities, a live
  family and enum-variant semantic-token responses, a live hover response, and shutdown
  followed by exit status 0. The same run passed all six Markdown fence composition
  cases against the installed VSIX grammars plus VS Code's own Markdown grammar.
- This evidence validates client/server transport, lifecycle, and VSIX wiring only. It is
  not evidence of the real Elisa compiler's semantic classifications; those remain
  behind the strict fresh-LSP gate while the sibling compiler/LSP build is in progress.
  The host test also checks that `elisa-enum-variant` falls back to the standard
  `enumMember` theme category; screenshot-based light/dark/high-contrast color inspection
  is still outstanding.

## Installed VSIX Restricted Mode verification (2026-09-14)

The earlier integration harness used `@vscode/test-electron`, which always adds
`--disable-workspace-trust`; it could not prove Restricted Mode behavior. The harness now
uses separate clean profiles: the trusted baseline still uses the standard test runner,
while the Restricted Mode case launches the same VS Code executable directly without
that flag and with Workspace Trust enabled. A fresh user-data directory sets the startup
prompt to `never`, so the new temporary workspace starts untrusted without a modal trust
decision. The restricted workspace contains hostile settings that select a nonexistent
server executable and enable verbose protocol tracing.

- `npm run test:integration`: passed on VS Code 1.137.0 in both trusted and actual
  Restricted Mode hosts. The suite asserted `vscode.workspace.isTrusted` for each run.
  In Restricted Mode, the packaged extension selected the explicit `ELISA_LSP` test
  server instead of the workspace path, reported tracing `off`, and completed semantic
  token, hover, shutdown, and exit checks.
- This proves the trust boundary in the installed extension host for the tested VS Code
  version. The same trusted/Restricted Mode checks now also pass on minimum VS Code
  1.85.0 (see below); Linux/Windows hosts, remote hosts, and theme rendering still need
  separate evidence.

## Minimum VS Code host validation (2026-09-14)

The integration runner now distinguishes the Language Server Protocol initialization
notification from semantic-token requests. It waits for initialization independently,
then verifies that `elisa.verifySupport` sent a semantic-token request for its own
`enum Verify` sample document. This avoids a timing-sensitive assumption that VS Code
will automatically refresh semantic tokens immediately after a document is shown.

- `env -u VSCODE_BIN VSCODE_VERSION=1.85.0 npm run test:integration`: passed on the
  declared minimum VS Code host in trusted and Restricted Mode.
- `npm run test:integration`: passed on the installed VS Code 1.137.0 host in trusted
  and Restricted Mode.
- Both runs passed all six Markdown fence-composition tests against that host's own
  Markdown grammar and the grammars loaded from the packaged VSIX.
- Both runs assert the extension path is the installed VSIX, the real LSP handshake and
  live support-verification requests occur, trust-sensitive settings are respected, and
  the same server process completes shutdown and exit.
- This is macOS arm64 evidence only; it does not establish Linux, Windows, remote, or
  screenshot/theme-rendering support.

## Compiler verification status (2026-09-14, updated 10:53 UTC)

The compiler evidence below is a limitation report, not a new confirmed miscompile. The
Elisa-compiler working tree has since acquired in-progress backend loop-region changes,
so the earlier clean-checkout observation must not be treated as the current tree. The
installed LSP binary matches its current LSP input fingerprint (`b66efe5f…`), but its
manifest compiler-source fingerprint (`0698d807…`) differs from the current compiler
source fingerprint (`c2315573…`). Accordingly, the strict semantic check must remain
closed until a matching compiler/LSP build is available. The compiler source fingerprint
changed during this work, so a build started against an earlier snapshot cannot be assumed
to cover the current source.

At 10:53 UTC, the shared stage1 process was still compiling `src/driver/elisac.elisa`
with `-O0` to `build/edir-driver.o`, after about 87 minutes and at roughly 95% CPU in
the latest process sample. This remains a material compile-time performance concern to
investigate, but no before/after baseline establishes that it is a regression or hang.
The extension task has not interrupted or duplicated the build.

One concrete compiler feature gap remains explicitly unchecked in
`Elisa-compiler/README.md`: broader generic and aggregate error-union propagation. The
reproducer `Elisa-compiler/test/repro/generic_error_union_propagation.elisa` exercises a
generic `pick[T]` returning aggregate `T error[ParseFail]`, propagated through `try`, and
documents intended native exit code 43. The stage0 semantic oracle accepted the input,
but the stale stage1 artifact refused the compile, so the current native result is not
known. Treat this as an unimplemented compiler capability pending a fresh build and
runtime check—not as an observed wrong-code bug.

## Current strict semantic-token gate (2026-09-14)

The current sibling Elisa-LSP release binary is fingerprint-current: built at
`2026-09-14T18:01:19Z`, artifact SHA-256
`b75e10cd459074d94e7f474d7603e3f7fc32b9b9067eeabb99676d7c1299f746`, LSP-input SHA-256
`fc6965739389a0b0dc3fd63257e96210aa28a14a82ba71e3a7d4588b819a99e8`, and compiler-source
SHA-256 `4b0ebab3aa9266856585b7cb68541b29c5ab65cf3d8b10531b8a8c67068d27ae`. The strict
plugin semantic golden reaches this binary and reports a confirmed classification defect:
in `shadow_family(Event: i32)`, the reference `Event.Resize` receives semantic token type
47 (`elisa.enum.variant`) even though `Event` is shadowed by a parameter. The family token
is correctly not classified as the enum type; only the member false-positive fails. This
is an Elisa-LSP semantic-resolution/coloring bug, not evidence of a compiler miscompile.

The regression is recorded by `test/semantic-golden.test.mjs`. The likely server cause is
that the qualified-variant branch in `Elisa-LSP/src/semtokens.elisa` consults the enum
variant registry before checking whether the receiver resolves to a parameter/local. A
narrow candidate fix and direct LSP regression assertion have since been added to those
already-dirty sibling files; all pre-existing work was preserved. The fix checks whether
the qualified receiver resolves to a parameter/local before claiming enum-variant
identity. The exact current source snapshot and verification status are recorded below.

The first full `npm test` attempt also exposed a test-protocol mismatch: the plugin test
sent `shutdown` with explicit `params: null`, while this server accepts the parameterless
request with `params` omitted. The test now omits that field, allowing the real semantic
assertion to run. On the pre-fix tree, `npm test` reported **120 passed, 1 failed, 1
skipped**; the failure was the shadowed-family false positive above, and the skip was the
optional installed-host Markdown grammar test. The current candidate-fix results are
recorded below. No VS Code window was launched, and no performance capture was taken while
shared compiler builds were consuming CPU.

## Headless semantic verification (2026-09-14)

All checks in this entry ran in CLI subprocesses; no VS Code or Electron window was
launched. The matching Elisa-LSP artifact at the end of the run was a debug `-O0` build
created at `2026-09-14T18:32:04Z`, with artifact SHA-256
`a1e7652c05d92bed5a72f51cff7269c518608b2c99432bf09aac0fe87d14f87c`, LSP input fingerprint
`bce31b2b48b403a7f54ded22af4fd13cde475e0e40f91a6f82203fc158dc6439`, and compiler-source
fingerprint `4b0ebab3aa9266856585b7cb68541b29c5ab65cf3d8b10531b8a8c67068d27ae`. The plugin's
provenance check reported that artifact and source fingerprints matched the live trees.

- `bash ../Elisa-LSP/test/semtokens_test.sh`: **passed**, 151 tokens checked, including the
  new shadowed-family negative assertion.
- `ELISA_REQUIRE_FRESH_LSP=1 node --test test/semantic-golden.test.mjs`: **2 passed, 0
  failed**. The compiler-backed occurrence-level golden confirms the enum family is not
  claimed when shadowed and the `Resize` member is not colored as a variant.
- Focused benchmark/client helper tests: **17 passed, 0 failed**. `npm run check`,
  `npm run audit:vsix` (18 packaged entries, no leaked build inputs), and `git diff
  --check` passed.
- `bash ../Elisa-LSP/test/run_all.sh` did not reach the server suite. Its first isolated
  build-script test stalled while starting its fake compiler through `/usr/bin/env`; a
  process sample showed that process still at macOS `_dyld_start` after two minutes. The
  test process group was stopped, and the independent Elisa-LSP build/process was left
  alone. Treat the full suite as **incomplete**, not passed or as a server assertion
  failure.
- An earlier attempt against the then-current release artifact timed out before LSP
  `initialize`; the subsequent matching debug artifact passed the direct semantic test
  and the plugin golden. Because the `-O2` artifact has not passed a normal launch and no
  stable release measurement was captured, release performance and full release-suite
  status remain unverified.

After those focused passes, the build manifest advanced to a release artifact created at
`2026-09-14T18:37:48Z` (SHA-256
`9e852b1983c34ce422c677d8bd00856192ae7c50809e4724a9c810fcafbf4798`) from LSP input
fingerprint `bce31b2b48b403a7f54ded22af4fd13cde475e0e40f91a6f82203fc158dc6439`. A later
freshness check found the live LSP fingerprint had advanced to
`a582263336de235c44c42489c19dc74f57c2a2f4fca2382933200c756bcf088c`; that release
artifact is therefore stale relative to the current sibling source and has no test claim
here. Concurrent sibling build/test activity was left untouched.

## Latest strict release verification (2026-09-14)

The live Elisa-LSP manifest now identifies a fingerprint-current release `-O2` artifact
built at `2026-09-14T18:42:45Z`: binary SHA-256
`5b7e122e09339dbb26684c5fd8112c90423b44630bb28bb39a0bae19b7540b86`, LSP input
fingerprint `a582263336de235c44c42489c19dc74f57c2a2f4fca2382933200c756bcf088c`, compiler
source fingerprint `4b0ebab3aa9266856585b7cb68541b29c5ab65cf3d8b10531b8a8c67068d27ae`, and
stage-0 compiler SHA-256 `51f5f5f1f33c65f71bb6a17acae8fcc45c74009ff27f6209a93a06ecd3d39b62`.
The extension's provenance checker confirmed that the binary, LSP inputs, and compiler
inputs matched after the focused verification.

- `bash ../Elisa-LSP/test/semtokens_test.sh`: **passed**, 151 semantic-token records,
  including the shadowed-family negative control.
- `ELISA_REQUIRE_FRESH_LSP=1 node --test test/semantic-golden.test.mjs`: **2 passed, 0
  failed** against this release artifact.
- `npm test`: **124 passed, 0 failed, 1 skipped**. The one skip is the optional test that
  composes with an installed VS Code Markdown grammar; bundled-host injection tests ran.
- `npm run check`, `npm run audit:vsix` (18 packaged entries, no leaked build inputs), and
  `git diff --check` passed.
- The full canonical LSP suite is still unverified for this snapshot. The earlier run
  stalled in its initial build-script guard before server tests; no result from a full
  suite is claimed here. No performance capture was taken while unrelated compiler work
  was active, and no VS Code/Electron window was launched.

## Guarded multi-root session update (2026-09-14)

The extension still intentionally uses one LSP process for a workspace, but it no longer
silently applies the first folder's executable to every root. Effective folder-scoped
settings are trust-filtered before comparison; workspace/shared relative paths resolve
from the first workspace root, while trusted folder-specific relative paths resolve from
their own root. Invalid or conflicting path contexts prevent process startup with a
redacted, actionable error. Conflicting trace levels force protocol tracing off for the
shared process. Adding/removing a workspace root restarts the client because this LSP
consumes roots at initialize and does not advertise dynamic folder-change support.

The following verification ran headlessly through Node/TypeScript/CLI tools. No VS Code
or Electron window was launched, and no performance benchmark was captured.

- `npm test`: **129 passed, 0 failed, 1 skipped**; the skip is the optional composition
  test requiring an installed VS Code Markdown grammar. New checks cover resolved path
  bases, incompatible/invalid workspace contexts, and refusing to spawn on conflicts.
- `npm run check`: passed.
- `npm run audit:vsix`: passed, 18 packaged entries and no leaked build inputs.
- `git diff --check`: passed.
- Full VS Code Extension Development Host integration and the full canonical Elisa-LSP
  suite remain unverified; this work intentionally used non-UI test paths.

## Headless verification after workspace-discovery changes (2026-09-14)

All plugin-side checks below ran in terminal/Node/TypeScript processes; no VS Code,
Electron, or Extension Development Host was launched, so they did not take window focus.

- `npm test`: **134 passed, 0 failed, 2 skipped**. One skip is the optional composition
  check that requires an installed VS Code Markdown grammar. The compiler-backed semantic
  golden skipped because the current Elisa-LSP sources no longer match the last built
  snapshot; this is a freshness guard, not a semantic assertion pass.
- `npm run check`: passed.
- `npm run audit:vsix`: passed, 18 packaged entries and no leaked build inputs.
- `git diff --check`: passed.
- `npm run test:semantic`: correctly failed closed because
  `LSP sources/project.json differ from the built snapshot`. No result from the stale
  server binary is treated as evidence. A release build is running from a separate
  temporary worktree, but it is not yet proven to have the same source fingerprint as
  this workspace. The canonical LSP suite and current-source semantic golden therefore
  remain unverified pending a matching build.
- No performance benchmark was run while unrelated Elisa compiler builds were consuming
  CPU. The full VS Code host integration remains intentionally unrun to preserve focus.

## Fresh LSP semantic and workspace-root verification (2026-09-14)

The Elisa-LSP release binary is now fingerprint-current with the live LSP and compiler
sources: built at `2026-09-14T20:00:50Z`, binary SHA-256
`d1e2bec91767839b68e87b0c8a9e0bab740d1217b2c1876d16b339b97472677b`, object SHA-256
`9628520cb9e155d8dc22ab05ecc4611585009d3eb3453b9097cd4b6fec0f92f5`, LSP input SHA-256
`6998a6d77e84f7fad8b396077fc7e0a40dde3e5589d7736bd22b7c028c04b8fb`, and compiler-source
SHA-256 `4b0ebab3aa9266856585b7cb68541b29c5ab65cf3d8b10531b8a8c67068d27ae`. Both the LSP
freshness checker and the extension's provenance inspection accepted this artifact.

The new `test/workspace_roots_test.sh` exposed and now covers two real workspace-inspection
defects: trailing-slash root URIs did not own descendant documents, and the unmatched-root
sentinel `-1` was passed to the compiler's non-negative-only integer writer, yielding an
invalid JSON response. Root matching now accepts a slash-terminated root as a complete
boundary, and the response uses the signed JSON integer writer. The regression covers
nested-root precedence, trailing-slash roots, sibling-prefix rejection, unmatched
documents, and legacy `rootUri` fallback.

Headless verification; no VS Code, Electron, or Extension Development Host was launched:

- `bash ../Elisa-LSP/test/workspace_roots_test.sh`: passed.
- `bash ../Elisa-LSP/test/diagnostics_test.sh`: passed after adding a compiler-backed
  namespace-type regression; `math.Box` produces exactly one `math::Box` correction at
  the namespace token, with the expected diagnostic range.
- Focused LSP `protocol_test.sh`, `uri_test.sh`, and `semtokens_test.sh`: passed; semantic
  token test checked 151 records.
- LSP `manifest_test.sh`: passed (48 legend entries, 13 advertised feature methods, and 20
  tested implementations).
- `npm run test:semantic`: **9 passed, 0 failed, 0 skipped** against the exact current
  artifact (`d1e2bec91767839b68e87b0c8a9e0bab740d1217b2c1876d16b339b97472677b`), including
  the compiler-backed enum-family/variant, struct-field type, shadowing, and UTF-16 golden.
- `npm test`: **135 passed, 0 failed, 1 skipped**. The sole skip is optional composition
  with an installed VS Code Markdown grammar.
- `npm run check`, `npm run audit:vsix` (18 entries, no leaked build inputs), LSP build
  freshness, and `git diff --check`: passed.
- Two canonical Elisa-LSP `test/run_all.sh` attempts passed their build-freshness gate and
  workspace-root regression but had transient failures: the first completed **58 passed,
  1 failed** after `test/failed_analysis_request_test.sh` timed out awaiting `initialize`
  after 10 seconds; the next completed **57 passed, 2 failed** after that analysis-request
  test timed out during shutdown and `test/analysis_worker_test.sh` timed out awaiting
  `initialize`. In both cases the affected test subprocess had empty stderr. A subsequent
  full run passed **59 passed, 0 failed**, including both fault-injection suites and the
  workspace-root regression, against a fingerprint-current artifact. That successful run
  still overlapped a long-running stage1 compiler build, so the earlier failures appear
  transient but have not been isolated to a specific cause. Retain the failure evidence and
  rerun the two fault suites separately before release; do not relabel either failed attempt
  as passing. No performance capture was made under that load.

A later canonical run, after the recorded clean pass, completed **58 passed, 1 failed**.
`test/uri_collision_test.sh`'s fresh isolated server did not answer `initialize` within the
10-second harness bound; the subprocess was killed/reaped with empty stderr. The run's
build-freshness gate passed, and all later tests in the suite completed. A separate
stage-0 run then completed **56 passed, 3 failed** after being invoked with the relative
override `ELISA_COMPILER_ROOT='../Elisa-compiler'`. Its `uri_collision_test.sh` passed, but
three generated compiler probes resolved that relative include from their temporary source
directory and failed to find `/var/folders/.../T/Elisa-compiler`; those three failures were
test-environment errors, not compiler or product failures. The LSP runner now canonicalizes
usable compiler roots before child tests, and its focused default/relative/missing-path test
passes. A default-root canonical rerun completed **58 passed, 1 failed**: URI collision
passed, while `frontend_contract_test.sh` exceeded its 30-second probe deadline with empty
stdout/stderr. This occurred under sustained unrelated compiler/simulator load and is not
classified as a compiler semantic defect. The complete LSP suite still needs a fresh rerun
after the path fix under a lower-contention host; the earlier failed attempts remain recorded
and are not counted as passes.

## Compiler qualified-type regression recheck (2026-09-14)

The Elisa-LSP plan had recorded a Go stage0 failure in
`TestAnalyzeRejectsDotModulePathInTypePosition` on compiler source snapshot
`601f7bcd3de62877723ab7f5c5f9a502fb6ef9ae`. That exact test passes on the Go compiler
checkout at `5284109ca5805560a488c3b0a5d8cd4a1a45e317`, and both its documented fast
`make test` and full sequential `make test-full` suites pass; the native-runtime package took
478.293 seconds. However, the `5284109` checkout has a separate confirmed backend regression
that those broad suites miss because this revision deleted its three focused C-ABI tests.
Between `601f` and `5284`, generated `memset`/`memcmp` call signatures changed from C `i32`
to Elisa `int` (`i64` on Darwin/arm64). Reconstructed zeroed-aggregate, darray-resize, and
string-comparison fixtures compile with stage0 SHA-256
`51f5f5f1f33c65f71bb6a17acae8fcc45c74009ff27f6209a93a06ecd3d39b62` and fail with the
`5284` build (`d97d0d3d6eaa3c1f457d62c4da3c8607cb3023574a03a13fe03a365e11a71dfe`) on
conflicting LLVM declarations. The clean `Go projects/structpy-tree` compiler worktree at
`601f` retains the `i32` implementations and all three regression tests. The stage0 binary
currently named `/tmp/elisac-stage0-latest-abi-fixed` (SHA-256
`532285b3680280dfe90713eeda499878e332a0362257614385222e02eb94b83e`) also passes all three
direct reproducers; it is the compiler recorded in the latest LSP manifest.

That latest LSP artifact (SHA-256
`1e9716bd26ec827df1418768fd2eeaf135d8a0ce341abf31c22ea11b8d588d65`) was built with the
ABI-passing compiler against frontend snapshot `e3db35828203fb51fe631e791adff6683640d3360ae95983970a3f71c8737c6d`, but current frontend sources changed afterward. The strict plugin semantic gate correctly rejects it as stale. A subsequent old-stage0 build also refused to publish after detecting source changes during compilation. Thus the C ABI defect is fixed in the tested binary/source snapshot but remains in the separate `Elisa-core` checkout at `5284`; the latest LSP artifact is not yet current against the moving frontend tree. No compiler source was edited here.

## Elisa-LSP artifact repeatability finding (2026-09-14)

Three successive release builds used the same recorded LSP input fingerprint
(`6998a6d77e84f7fad8b396077fc7e0a40dde3e5589d7736bd22b7c028c04b8fb`), compiler source
fingerprint (`4b0ebab3aa9266856585b7cb68541b29c5ab65cf3d8b10531b8a8c67068d27ae`), stage0
compiler binary, and `-O2` flags, yet produced different object/executable checksums. The
earlier object/executable were `416252c2e9869771cf002e9bae86a776b559612bf9efc67e06573094fec13cd7`
and `216ada30d3c9fe171a7b6bf6ae1e8f54f4d838ebbae8924722a8148684f19395`; the latest pair
are `393f57fdeb072a17d4649028a702aaa2b89f8323923b01e572e5c1e503bdb06c` and
`2e098f8a9e2cc1f93c36677bf6f0c6022d993cb883d706a9cf3f3e9fcfe89c87`; the third pair are
`9628520cb9e155d8dc22ab05ecc4611585009d3eb3453b9097cd4b6fec0f92f5` and
`d1e2bec91767839b68e87b0c8a9e0bab740d1217b2c1876d16b339b97472677b` (built
`2026-09-14T20:00:50Z`).

The build script stages source beneath a randomized `build/.elisa-lsp-build.XXXXXX`
directory. `strings` confirms that this random absolute path is present in the latest object
and executable, making it a strong candidate cause of the checksum drift and an avoidable
path disclosure in artifacts; causality has not yet been isolated. The current freshness
fingerprint also excludes `build.sh` and `scripts/build_hashes.py`, so changes to those
build-affecting files are not represented in the recorded source identity. Reproducible
builds and complete pipeline provenance remain open; no compiler language-semantics defect
is inferred from this build evidence.

## Bounded semantic-legend compatibility validation (2026-09-14)

The extension now validates semantic token legends at initialization without silently
filtering malformed entries. It distinguishes an absent legend from an explicitly empty
legend, rejects malformed/non-string entries and duplicate IDs, detects missing, unexpected,
or reordered token types, and normalizes legacy dotted IDs only when they map to a declared
canonical ID. The required server token-modifier legend is also validated and duplicate
modifier IDs are rejected. The client type list and server type/modifier lists are capped at
256 entries before normalization or copying, each ID is capped at 128 characters, and each
list's aggregate text is capped at 16 KiB (the current Elisa taxonomy has 48 short types).
An invalid advertised legend degrades compatibility with a concrete explanation rather than
claiming valid color-index mapping.

Headless verification after this change:

- `npm run check` and `npm run compile`: passed.
- `node --test test/compatibility.test.mjs`: **17 passed, 0 failed**.
- All non-server-backed plugin tests: **145 passed, 0 failed, 0 skipped**. The installed
  VS Code Markdown grammar was supplied so its optional composition check ran; the
  server-backed semantic golden was deliberately excluded because the canonical LSP suite
  was concurrently running.
- `npm run audit:vsix`: passed (18 packaged entries, no leaked build inputs); `git diff --check`
  passed. No VS Code, Electron, or Extension Development Host was launched, so verification
  did not take window focus.

This improves initialization correctness and bounds the extension's normalization work; it
does not prove rendered theme behavior or broaden compiler semantic coverage. The full
server-backed golden and host/theme matrix remain release gates.

## Offline composition with the installed Markdown host grammar (2026-09-14)

The Markdown injection was tested with the actual grammar file shipped by the installed
Visual Studio Code **1.137.0** `markdown-basics` extension. The test used the bundled
TextMate/Oniguruma tokenizer in a Node process; it read the grammar from the app bundle but
did not launch VS Code, Electron, or an Extension Development Host and did not take window
focus.

- `VSCODE_MARKDOWN_GRAMMAR='/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/markdown-basics/syntaxes/markdown.tmLanguage.json' node --test test/markdown-injection.test.mjs`: **6 passed, 0 failed, 0 skipped**, including installed-host grammar composition and Elisa/non-Elisa fence boundary checks.

This closes the grammar-file composition check for this host version. It does not verify
extension activation in the host, semantic-token colors, theme/high-contrast rendering, or
the minimum supported VS Code version; those remain open release gates.

## Freshness recheck after compiler frontend edits (2026-09-14)

The Elisa-compiler frontend worktree changed after the earlier 9/9 server-backed semantic
golden run. Re-running `ELISA_REQUIRE_FRESH_LSP=1 npm run test:semantic` now fails closed:
8 taxonomy/schema checks pass, and the compiler-backed golden refuses the LSP artifact with
`Elisa-compiler sources differ from the built snapshot`. This is a stale-build rejection,
not a current semantic-token mismatch. The current Go stage0 also has the confirmed
`memset`/`memcmp` ABI bug above and fails to build the LSP; the old stage0 succeeds on the
same current inputs in an isolated copy. Therefore the earlier enum-family, variant,
struct-field, and shadowing golden remains valid for its recorded old snapshot, but it is not
current evidence for the newly edited frontend until a corrected compiler can produce a fresh
LSP build. The VS Code application was not launched during these checks.

## Compiler fingerprint parity and latest LSP suite (2026-09-14)

The plugin's compiler-source fingerprint now matches the Elisa-LSP build helper exactly,
including both `src/` and `elisacore_std/`. A previous client-only hash omitted the standard
library tree, so it could disagree with the build manifest even when the relevant frontend
sources were identical. The regression test verifies that standard-library-only edits
invalidate the snapshot. A direct comparison produced identical hashes from the client and
server implementations for both the recorded snapshot and the live checkout.

Using the ABI-fixed stage0 compiler (SHA-256
`532285b3680280dfe90713eeda499878e332a0362257614385222e02eb94b83e`), a release LSP build
was recorded at `2026-09-14T21:43:38Z`: artifact SHA-256
`b284e5fafc018c6267bcff9822da8f992e0e695da8c73cbfd5634854d6ddc38b`, compiler-source
snapshot SHA-256 `56eefc7e1f82110c1abfa05a2b17c0dd4a3fe00d0c64dd99c5285013e9e10e47`, and LSP
input SHA-256 `6998a6d77e84f7fad8b396077fc7e0a40dde3e5589d7736bd22b7c028c04b8fb`. The canonical
`bash test/run_all.sh` completed **60 passed, 0 failed**, including transport bounds,
semantic tokens, navigation, signature help, storage reclamation, URI churn, positions,
diagnostics, recovery, and frontend-contract tests.

The plugin's headless `npm test` completed **146 passed, 0 failed, 2 skipped**; its TypeScript
check and 18-entry VSIX audit passed. The focused enum/Markdown grammar run passed **20/20**
with the installed VS Code Markdown grammar supplied. No VS Code, Electron, or Extension
Development Host was launched. However, the compiler frontend changed after the recorded
LSP snapshot: the live source hash advanced to
`ea38bb668bc5086e6a22c5173f839c678ab65c2b845c95c225fa28615406c9ea`. Consequently the strict
compiler-backed semantic golden correctly refuses this artifact as stale; the 60/0 server
suite is evidence for its recorded snapshot, not for the newer live frontend. Independent
compiler/test processes overlapped, so no performance conclusion is drawn from these runs.

## Current cross-repository headless baseline (2026-09-15)

This section supersedes the stale-artifact and pipeline-fingerprint conclusions above where
they describe the current build. It does not erase those historical results.

Environment and provenance:

- Host: macOS ARM64; installed VS Code grammar version **1.137.0**; Node.js `v26.8.2`,
  npm `11.19.1`.
- Extension source revision: `bdbab60658ae7407ead524d256b5b679ca5f60fe`; working tree had
  55 porcelain status entries during verification.
- Elisa-LSP source revision: `b6d284baabe688daf9d053470c5e560b8990914a`; working tree had
  100 porcelain status entries during verification.
- Release LSP manifest was built at `2026-09-15T00:01:14Z`, profile `release`/`-O2`, for
  `Darwin/arm64`. Recorded LSP inputs are
  `cc57788b6962ccab0c3884edbe0a7a50dfdcc20e1dc6273b96fa0edd212a3cbe`; build-pipeline
  inputs are `725b9f978c4871f6d639dcd8cbf589c46428d233ae998febf853434b1989fc12`; the
  executable SHA-256 is
  `254933ebaef777c11821bb78e6262501fdf7d5125382d1eb2869a3cbbefe4180`.
- The LSP's strict freshness checker passed against the live inputs and artifact. The
  current build fingerprints `build.sh`, `project.json`, and `scripts/build_hashes.py`;
  pipeline drift is rejected rather than omitted from provenance.
- The build compiles from a content-addressed, read-only source snapshot. A `strings`
  inspection found no randomized `.elisa-lsp-build.<nonce>` staging path in the executable
  or object, unlike the older experiment. It did find the absolute content-addressed source
  snapshot path. Same-root duplicate-build byte identity and cross-root path normalization
  remain unverified; reproducibility is therefore still open.

Headless verification:

- `bash ../Elisa-LSP/test/run_all.sh`: **60 passed, 0 failed** on the freshness-checked
  release artifact. This included build-script serialization/safety, strict transport and
  JSON tests, 9,596 exhaustive short-byte position cases, diagnostics/recovery, semantic
  tokens, hover/signature/navigation, document/workspace-root behavior, storage budgets,
  analysis-worker isolation, and frontend-contract checks.
- `npm run check`: passed.
- `VSCODE_MARKDOWN_GRAMMAR='/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/markdown-basics/syntaxes/markdown.tmLanguage.json' npm test`:
  **148 passed, 0 failed, 0 skipped**. The run included installed-host Markdown grammar
  composition and the compiler-backed enum-family/variant golden fixture.
- `npm run audit:vsix`: passed; 18 packaged entries, no leaked build inputs.
- No VS Code application, Electron process, or Extension Development Host was launched.
  The Markdown test read the installed grammar file directly in Node; these checks do not
  prove semantic-token rendering or light/dark/high-contrast theme appearance.

Timing caveat: two earlier standalone `manifest_test.sh` runs hit the test's five-second
initialize deadline. A direct protocol probe received a valid initialize response in about
15 ms, a later manifest test passed, and the complete 60/0 LSP suite passed. The timeout has
not reproduced in the full suite; treat it as an unresolved intermittent timing signal, not
as a confirmed server defect or as proof that tail latency meets the plan's target.

Compiler correctness finding: the stage0 compiler currently pinned by that LSP manifest
(binary SHA-256 `51f5f5f1f33c65f71bb6a17acae8fcc45c74009ff27f6209a93a06ecd3d39b62`) was
independently probed with a module type. It accepts invalid dotted type syntax such as
`math.Box` in semantic-only mode; object generation then traps in LLVM ABI type sizing.
The namespace-qualified `math::Box` form succeeds. Compiler Go test executables stalled at
macOS runtime startup in this environment, so this finding is based on direct CLI behavior,
not a passing Go test suite. Verify whether a newer compiler source/build fixes this before
shipping a refreshed LSP artifact.

## Alias-qualified enum semantic slice (2026-09-15)

The extension and LSP gained a narrow compiler-backed alias contract for the previously
missing case where a type alias is used as an enum family: `type EventAlias = Event`,
`EventAlias.Resize(1)`, and `EventAlias.Resize(size):`. The compiler records parallel alias
name/target/module metadata; the LSP validates the parallel-array shape and follows only a
bounded chain of bare targets. Empty, cyclic, or otherwise unmodeled targets remain
unclassified. This is deliberately exact for the supported slice and conservative outside
it.

Headless evidence against the release artifact built at `2026-09-15T00:47:22Z` (artifact
SHA-256 `9e660efbc28d7b82738c80e38327245eaf287ba86827a9abc2dc2815315091e8`):

- `ELISA_REQUIRE_FRESH_LSP=1 node --test test/semantic-golden.test.mjs`: 2 passed, including
  the alias-qualified constructor and pattern assertions.
- `bash ../Elisa-LSP/test/semtokens_test.sh`: 191 tokens, classifications verified.
- `bash ../Elisa-LSP/test/frontend_contract_test.sh`: passed contract v5 validation,
  including parser recovery, offset boundaries, navigation spans, and semantic-table shape.
- The extension's complete headless gate with the installed Markdown grammar supplied passed
  148 tests, 0 failures, and 0 skips; no VS Code, Electron, or Extension Development Host
  was launched.

After that artifact was built, the live compiler frontend changed. The strict LSP freshness
check therefore rejects the artifact, and `bash ../Elisa-LSP/test/run_all.sh` correctly stops
before server tests rather than claiming current-source coverage. The alias slice is proven
for the recorded artifact only until a new synchronized compiler/LSP build completes. The
current implementation still lacks module-qualified target identity and same-name
cross-module alias resolution; those remain release gates.

## Headless-only verification and compiler safety follow-up (2026-09-15)

All verification in this follow-up was performed as ordinary subprocesses. No VS Code
application, Electron process, Extension Development Host, or UI automation was started,
so the checks cannot take the editor window's focus.

The extension's strict headless gate was run with `ELISA_HEADLESS=1` and
`ELISA_REQUIRE_FRESH_LSP=1` through `npm run test:headless`. The lexical, configuration,
discovery, lifecycle, benchmark, Markdown grammar, and safety checks passed **147/148**.
The one failing test was the compiler-backed semantic golden, which failed closed because
the shared `build/elisa-lsp` artifact no longer matched the live LSP source/project hash.
That is the intended result: the gate did not use stale semantic evidence. The gate stopped
before its later type-check and VSIX-audit phases; the previously recorded fresh run remains
the evidence for those phases. The standalone headless LSP checks for compiler-root
discovery, malformed UTF-8 JSON escaping, and JSON-RPC parsing all passed after the test
harness was made relocatable through `ELISA_COMPILER_ROOT`.

Compiler correctness finding and source-level repair:

- The pinned stage0 compiler (`51f5f5f1f33c65f71bb6a17acae8fcc45c74009ff27f6209a93a06ecd3d39b62`)
  accepted an invalid dotted namespace type such as `math.Box` in semantic-only mode, then
  reached LLVM ABI type sizing and trapped during object emission. The correct spelling
  `math::Box` was already accepted.
- The compiler source now preserves the once-only diagnostic marker across speculative
  inference passes. Previously, a suppressed pass consumed the marker, causing the real
  pass to skip the diagnostic and allowing an invalid type to reach the backend. The same
  protection was applied to value-position namespace paths.
- The compiler regression test exercises `-emit obj`, requires the exact namespace
  diagnostic, rejects LLVM trap text, and asserts that no object is left behind. The focused
  Go tests, semantic namespace tests, and direct patched-compiler probe passed; the patched
  compiler rejected the source with exit code 1 and no backend trap.

The pinned stage0 binary has not been replaced. A fresh Go-built compiler containing the
source repair produced a safe result for the small dotted-type probe, but it is not yet
release-qualified: an `-O2` LSP built with it omitted an expected structured document log
event, while an `-O0` build failed the LSP handshake. The old pinned stage0 artifact passes
that observability check, so this is recorded as a compiler/toolchain code-generation or
reproducibility regression rather than hidden as an extension failure. No new LSP artifact
will be treated as current release evidence until the compiler build is reproducible and
passes the full protocol/provider suite.

The shared LSP rebuild was also deliberately not declared successful when an environment
signal terminated it. Existing concurrent build jobs were left untouched. This preserves
artifact safety and is why the strict freshness failure above remains visible instead of
being bypassed.
