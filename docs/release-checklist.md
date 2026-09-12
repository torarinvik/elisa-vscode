# Release checklist status

Mirrors the definition of done from the implementation plan. A checked item has concrete
evidence in this repository; unchecked items state what is missing. No item is checked
because code exists.

## Semantic correctness

- [x] Every advertised semantic category has positive and negative fixtures.
  Evidence: `test/semantic-token-manifest.test.mjs` validates every declared type and
  scope; `test/grammar-highlighting.test.mjs` asserts positive and negative occurrences;
  `test/semantic-golden.test.mjs` checks compiler-backed classification.
- [x] Enum family and variant declarations/references/patterns use resolved identity.
  Evidence: the golden fixture asserts `Event` type references, variant declarations,
  qualified patterns, and `resize` pattern bindings; `raw.UiKey()` and `tool.Method(1)`
  remain function uses.
- [ ] Shadowing, aliases, imports, incomplete code, and Unicode ranges are covered.
  Missing: a shadowing local named `Event`, alias resolution, import fan-out, and
  incomplete-source goldens. The grammar layer covers Unicode identifiers per the
  engine; the server owns the remaining cases.
- [x] Diagnostics and edits cannot apply stale generations.
  Evidence: sibling `diagnostics_version_test.sh` and `documents_test.sh`; client-side
  generation guards in `src/serverSession.ts` plus race tests.
- [x] All feature coordinates use the shared position contract.
  Evidence: sibling `positions_test.sh` and `diagnostic_ranges_test.sh`.
- [x] No feature presents a heuristic answer as an exact compiler result.
  Evidence: the lexical layer drops dotted-PascalCase guessing; mismatch handling marks
  a degraded session instead of applying misaligned tokens.

## Performance and resources

- [ ] Named reference workloads and machines are recorded.
  Partial: machine metadata and synthetic scaling sources are recorded in
  `docs/performance.md`; tiny/typical/large-project fixture classes are not frozen.
- [ ] p50/p95/p99 and maximum latency reported for interactive operations.
  Partial: grammar tokenization, discovery, and real stdio round trips for `initialize`,
  `semanticTokens/full`, and `hover` are reported in `docs/performance.md` with a
  capture artifact. Completion, rename, and diagnostics are not implemented yet.
- [x] Activation/discovery does not block the extension host on filesystem scans.
  Evidence: asynchronous bounded discovery with tests; activation performs only
  configuration parsing and channel creation.
- [x] Idle operation performs no unnecessary recurring analysis.
  Evidence: no polling loops; timers exist only for a pending crash restart or the
  one-shot stability reset.
- [x] Queues, caches, logs, framing, and background work are bounded.
  Evidence: successful-resolution cache with key invalidation; bounded probe
  concurrency; health/log output is line-bounded; framing is server-owned and covered by
  sibling protocol tests.
- [ ] Open/close/restart soak tests show no unexplained retained growth.
  Partial: `test/soak.test.mjs` proves timer and lifecycle hygiene across 200 cycles, not
  heap retention across editor sessions.
- [x] Scaling tests detect and prevent accidental superlinear behavior.
  Evidence: `test/hostile-inputs.test.mjs` adversarial lines plus the bench harness's
  `N`/`2N`/`4N` scaling samples.

## Safety and reliability

- [x] Untrusted workspaces do not automatically execute nearby toolchains.
  Evidence: discovery trust gating tests.
- [x] Process arguments and paths are handled without shell interpolation.
  Evidence: `spawn` with argument arrays; discovery never builds command strings;
  NUL-containing settings are rejected.
- [x] Startup, crash, restart, and shutdown races are tested.
  Evidence: `test/lifecycle.test.mjs` covers stop during discovery, stop during start,
  concurrent restarts, exit during stop, crash backoff, and double disposal.
- [x] Source-derived UI content is untrusted and escaped.
  Evidence: the client renders no source-derived HTML; health/support reports sanitize
  newlines and redact home paths; hover Markdown policy is documented and server-owned.
- [x] Support reports are bounded, redacted, and previewed before export.
  Evidence: `test/config-health.test.mjs` and the Collect Support Report command.
- [ ] Broad edits are atomic, version-aware, and collision-checked.
  Missing: this client release advertises no rename/format/edit feature, so the
  requirement is vacuous here and remains gated on the server.

## Product and distribution

- [x] Clean-profile VSIX installation is tested.
  Evidence: `npm run smoke:vsix` packages the VSIX, installs it into an isolated
  `--extensions-dir`/`--user-data-dir` profile through the bundled VS Code CLI, and
  verifies the unpacked extension contains `package.json`, `dist/extension.js`, and the
  grammar. Extension-host behavior tests are available via `npm run test:integration`.
- [x] Missing-server setup is actionable and preserves lexical support.
  Evidence: shared failure handling, setup actions, and a missing-server notification
  with Open Setting, Select Executable, Setup Guide, and Discovery Report.
- [ ] Light/dark/high-contrast behavior is verified in actual hosts.
  Missing: no host matrix was available; standard supertype fallbacks and scope mappings
  are validated statically, and `docs/highlighting.md` records the inspection workflow.
- [ ] Supported platform/remote combinations have real evidence.
  Partial: macOS arm64 is the recorded baseline; Linux is a CI target; Windows and
  remote hosts are explicitly experimental.
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
