# Release checklist status

Mirrors the definition of done from the implementation plan. A checked item has concrete
evidence in this repository; unchecked items state what is missing. No item is checked
because code exists.

Last complete `npm test` before the latest extension-only semantic-legend validation
(2026-09-14) reported **135 passed, 0 failed, 1 skipped** (136 tests total); the skip is
the optional test that composes with an installed VS Code Markdown grammar. The latest
post-change headless run covered every non-server-backed plugin test and reported **145
passed, 0 failed, 0 skipped**; the installed Markdown grammar was supplied to run its host
composition case. The server-backed semantic golden was excluded while a separate canonical
Elisa-LSP test run was active. After the extension-only change, `npm run check`,
`npm run compile`, 17 focused compatibility tests, and the VSIX content audit (18 entries,
no leaked build inputs) passed. The 1.137.0 host grammar was read offline; no VS Code or
Electron app was launched.
The last exact-artifact `npm run test:semantic` run reported
**9 passed, 0 skipped**. The current artifact was built at
`2026-09-14T20:00:50Z` and is SHA-256
`d1e2bec91767839b68e87b0c8a9e0bab740d1217b2c1876d16b339b97472677b` (object
`9628520cb9e155d8dc22ab05ecc4611585009d3eb3453b9097cd4b6fec0f92f5`), built from LSP
inputs `6998a6d77e84f7fad8b396077fc7e0a40dde3e5589d7736bd22b7c028c04b8fb` and compiler
sources `4b0ebab3aa9266856585b7cb68541b29c5ab65cf3d8b10531b8a8c67068d27ae`. The strict
golden covers enum declaration/use/constructor color, shadowing negatives, `Vec2`/`Size`
struct-field types, and UTF-16 positions. `npm run check`, `npm run audit:vsix` (18
entries, no leaked build inputs), and `git diff --check` pass for this source snapshot.

Release reproducibility is currently **not established**: three builds with the same
recorded source/toolchain hashes and flags produced different object/executable hashes.
The LSP build places inputs in a randomized temporary directory, whose absolute path is
present in the compiled artifacts. This is a likely source of nondeterminism, not yet a
controlled causal proof. The LSP manifest now records a build-pipeline fingerprint over
`build.sh`, `project.json`, and `scripts/build_hashes.py`, and the build refuses publication
if those inputs change mid-build. The canonical freshness checker and plugin provenance gate
both validate that fingerprint. This closes the missing-pipeline-provenance gap, but byte-
identical controlled rebuilds and removal or normalization of random staging paths remain
release gates.

The most recent installed VS Code 1.137.0 integration and isolated VSIX installation
passed on an earlier extension snapshot. That test used trusted and Restricted Mode
profiles, a bounded fake LSP, and the host's Markdown grammar; it validates package/client
lifecycle and trust boundaries, not compiler classification. It has **not** been rerun
after the latest multi-root discovery changes. This verification pass used CLI tests only;
no VS Code or Electron window was launched. Treat the earlier installed-host result as
historical, not as proof of the exact current package. Markdown support remains lexical
only and Markdown host documents do not receive Elisa LSP features. The current Markdown
injection was independently composed offline with the installed VS Code 1.137.0
`markdown-basics` grammar (**6 passed, 0 failed, 0 skipped**) without launching the host;
that checks this grammar snapshot, not extension activation, semantic colors, or themes.

The last clean canonical Elisa-LSP `test/run_all.sh` run passed the build-freshness gate and
completed **59 passed, 0 failed** against the fingerprint-current artifact. It includes the
workspace-root regression and both fault-injection/recovery suites. Later attempts remain
recorded as failures: **58/1** from an analysis-request initialize timeout, **57/2** from an
analysis-request shutdown timeout plus worker initialization timeout, and **58/1** from
`uri_collision_test.sh` timing out while awaiting initialize; affected subprocesses had empty
stderr. One subsequent stage-0 run completed **56/3** with an invalid relative
`ELISA_COMPILER_ROOT`; three generated probes resolved their includes from temporary source
directories and could not find the compiler tree, while the URI-collision test passed. A
default-root stage-0 run was active when this checklist was updated and had no completed
result yet. The clean run also overlapped a long-running stage1 compiler build, so it does
not isolate the cause of the intermittent startup failures; rerun the failing cases
individually and complete a clean canonical run before release.
The strict `npm run test:semantic` gate is fail-closed for missing/stale LSP binaries or
token schemas, unlike ordinary `npm test`; its 9-case compiler-backed golden passed against
the exact artifact above. Remaining unchecked items below reflect incomplete coverage or
missing host/platform evidence.

## Semantic correctness

- [ ] Every advertised semantic category has positive and negative fixtures.
  Partial: the manifest and theme fallback are structurally checked, and lexical grammar
  fixtures cover many positive/negative roles, including user-defined types in struct
  field annotations. The client now rejects malformed, duplicate, reordered, and
  oversized semantic-token legends rather than trusting their indices. The semantic golden
  covers selected enum, type, and function cases only; it does not prove all 48 server
  classifications.
- [ ] Enum family and variant declarations/references/patterns use resolved identity.
  Current focused evidence: `npm run test:semantic` passed against the fingerprint-current
  LSP and verifies enum declaration/use/constructor colors, `Rect.origin: Vec2`,
  `Rect.size: Size`, UTF-16 columns after a non-ASCII field name, and a local `Event`
  shadowing the enum. Full declaration/reference/pattern positive and negative coverage,
  and wider aliases/imports, remains incomplete.
- [ ] Shadowing, aliases, imports, incomplete code, and Unicode ranges are covered.
  Partial: an earlier tested LSP snapshot covered a local shadowing an ordinary user type
  and malformed/incomplete-source recovery; the current strict semantic golden now also
  covers a local specifically shadowing enum family `Event`. Alias resolution, import
  fan-out, and complete semantic Unicode-range coverage remain missing.
- [ ] Diagnostics and edits cannot apply stale generations.
  Partial: client lifecycle races and an earlier LSP snapshot's document-version,
  incremental-sync, and versioned-diagnostic tests passed; edit-producing features remain
  unadvertised and gated. Against the exact current artifact, `diagnostics_test.sh` now
  also asserts that a dotted module type `math.Box` yields exactly one actionable
  `math::Box` diagnostic over the namespace token; that focused test passed. Re-run the
  broader document-version and incremental-sync matrix against the current source before
  release.
- [ ] All feature coordinates use the shared position contract.
  Earlier snapshot evidence: 9,596 exhaustive short-byte-string position cases plus
  semantic, diagnostic, and definition range checks passed. Broader end-to-end Unicode
  coverage across every feature, including the new struct-field regression, is still
  required against a fresh build.
- [ ] No feature presents a heuristic answer as an exact compiler result.
  Partial: the lexical layer drops dotted-PascalCase guessing and legend mismatches mark
  a degraded session. The current strict gate passes selected positive/negative
  family/variant and shadowing cases; wider resolver and import coverage remains
  incomplete.

## Performance and resources

- [ ] Named reference workloads and machines are recorded.
  Partial: machine metadata and synthetic scaling sources are recorded in
  `docs/performance.md`; tiny/typical/large-project fixture classes are not frozen.
- [ ] p50/p95/p99 and maximum latency reported for interactive operations.
  Partial: grammar tokenization, discovery, and real stdio round trips for `initialize`,
  `semanticTokens/full`, and `hover` are reported in `docs/performance.md` with capture
  artifact `benchmarks/2026-09-14-macos-arm64.json` from an earlier fingerprint-matched
  build. The current source has changed since; remeasure before using these values for
  release decisions. That capture's
  750-line workload measured semantic-token p50/p95/p99/max of
  0.238/0.331/0.399/0.399 ms and hover 0.111/0.185/0.200/0.200 ms. These are single-run
  observations, not controlled regression gates. Completion, rename, and diagnostics
  latency are not implemented or measured yet.
- [x] Activation/discovery does not block the extension host on filesystem scans.
  Evidence: asynchronous bounded discovery with tests; activation performs only
  configuration parsing and channel creation.
- [x] Idle operation performs no unnecessary recurring analysis.
  Evidence: no polling loops; timers exist only for a pending crash restart or the
  one-shot stability reset.
- [ ] Queues, caches, logs, framing, and background work are bounded.
  Partial: client discovery concurrency, cache size, and health/log output are bounded.
  An earlier server snapshot passed strict framing, output-write, JSON size/depth, and
  storage-reclamation tests. Re-run those against current sources; scheduler/backpressure
  evidence and a heap-retention soak remain pending.
- [ ] Open/close/restart soak tests show no unexplained retained growth.
  Partial: `test/soak.test.mjs` proves timer and lifecycle hygiene across 200 cycles, not
  heap retention across editor sessions.
- [ ] Scaling tests detect and prevent accidental superlinear behavior.
  Partial: hostile-line bounds and `N`/`2N`/`4N` benchmark samples exist, but the scaling
  measurements do not yet have a controlled-runner regression gate.

## Safety and reliability

- [x] Untrusted workspaces cannot select a server or enable tracing through workspace/
  folder settings and do not automatically execute nearby toolchains.
  Evidence: VS Code `restrictedConfigurations`, setting-selection tests, and discovery
  trust-gating tests. The installed-VSIX integration also runs with Workspace Trust
  enabled and asserts `workspace.isTrusted === false` while hostile workspace server and
  trace settings are present; the environment server is selected and tracing remains off.
- [x] Process arguments and paths are handled without shell interpolation.
  Evidence: `spawn` with argument arrays; discovery never builds command strings;
  NUL-containing settings are rejected.
- [x] Startup, crash, restart, and shutdown races are tested.
  Evidence: `test/lifecycle.test.mjs` covers stop during discovery, stop during start,
  concurrent restarts, exit during stop, crash backoff, and double disposal.
- [ ] Multi-root analysis contexts are isolated or proven safe to share.
  Partial: effective per-folder paths are compared after trust and relative-path
  resolution; automatic discovery checks each root independently under a four-probe
  global cap and blocks on differing/unresolved executables; trust/root changes force
  rediscovery, and the current 32-root server limit is enforced. However, the LSP does not
  yet create independent project/toolchain contexts, and conflicting-symbol semantics
  across roots have not passed an integration test. Per-folder semantic isolation is not
  available.
- [x] Source-derived UI content is untrusted and escaped.
  Evidence: the client renders no source-derived HTML; health/support reports sanitize
  newlines and redact home paths; hover Markdown policy is documented and server-owned.
- [x] Support reports are bounded, redacted, and previewed before export.
  Evidence: `test/config-health.test.mjs` and the Collect Support Report command.
- [ ] Broad edits are atomic, version-aware, and collision-checked.
  Missing: this client release advertises no rename/format/edit feature, so the
  requirement is vacuous here and remains gated on the server.

## Product and distribution

- [ ] Clean-profile VSIX installation is tested for the exact current extension snapshot.
  Evidence: `npm run smoke:vsix` packages the VSIX, installs it into an isolated
  `--extensions-dir`/`--user-data-dir` profile through the bundled VS Code CLI, and
  verifies the unpacked extension contains `package.json`, `dist/extension.js`, the
  standalone Elisa grammar, and the Markdown injection grammar.
- [ ] Installed VSIX activates in a clean stable VS Code extension host for the exact
  current extension snapshot.
  Evidence: `npm run test:integration` builds and installs the VSIX into an isolated
  profile, runs a separate test-host extension, and asserts the activated extension's
  real path is the installed package. The suite checks language/command registration,
  Markdown grammar contribution metadata, and Markdown host-language identity on VS Code
  1.137.0 in separate trusted and Restricted Mode profiles. A test-only LSP executable
  is started through the extension's normal discovery
  and LanguageClient path; the suite verifies initialization, server provenance and
  capabilities, family and enum-variant semantic tokens, and hover requests, then checks
  graceful shutdown and process exit. It also loads both grammars from the installed VSIX
  and tokenizes Elisa fences against that executable's own Markdown grammar; all six
  host-composition cases passed. The fake LSP validates transport integration only, not
  compiler semantics or rendered theme colors.
  This is one stable-host result, not the minimum/current plus theme matrix.
- [x] Missing-server setup is actionable and preserves lexical support.
  Evidence: shared failure handling, setup actions, and a missing-server notification
  with Open Setting, Select Executable, Setup Guide, and Discovery Report.
- [ ] Light/dark/high-contrast behavior is verified in actual hosts.
  Partial: the installed VS Code 1.137.0 host accepts the corrected semantic-token schema
  without warnings; rendered color inspection across light, dark, and high-contrast themes
  remains unavailable. Standard fallback and scope mappings are statically validated, and
  `docs/highlighting.md` records the inspection workflow.
- [ ] Supported platform/remote combinations have real evidence.
  Partial: macOS arm64 is the recorded baseline; Linux is a CI target; Windows and
  remote hosts are explicitly experimental. Installed-VSIX integration passed on
  macOS arm64 with VS Code 1.85.0 (the declared minimum) and 1.137.0, in trusted and
  Restricted Mode. Linux, Windows, remote-host, and theme-rendering evidence remains
  pending.
- [x] Watch and release builds behave consistently.
  Evidence: `scripts/build.mjs` is the single pipeline; the audit rejects build inputs
  and source maps from the package.
- [x] Package contents, licenses, versions, and build provenance are checked.
  Evidence: VSIX audit, LICENSE inclusion, build identifier in the health report, and
  the sibling server's provenance manifest.
- [x] README and capability advertising match shipped behavior.
  Evidence: capabilities come from `initialize`; the health report and README list only
  implemented commands and features.
- [x] Upgrade and rollback limitations are documented.
  Evidence: `docs/compatibility.md` upgrade and rollback section plus `CHANGELOG.md`.
