# Changelog

Release notes distinguish new features, corrected semantics, performance changes with
measurement context, compatibility changes, and known limitations.

## 0.1.0 (unreleased)

### New features

- Commands: Restart Language Server, Show Language Server Output, Show Health Report,
  Verify Support (live semantic-token and hover check), Configure Language Server,
  Explain Highlighting, Collect Support Report.
- A single quiet language-status item with lifecycle transitions and accessible text.
- Opt-in protocol tracing via `elisa.trace.server` (`off`/`messages`/`verbose`) with a
  separate trace channel and a source-code warning; trace changes apply without a
  restart.
- Redacted health and support reports that are previewed before export; no telemetry.
- A packaged VSIX content audit and an isolated install smoke harness.

### Corrected semantics

- The TextMate grammar no longer guesses that any dotted PascalCase name is an enum
  variant. `raw.UiKey()`, `tool.Method(1)`, and unresolved `Family.Variant` uses are not
  classified as enum members by the lexical layer.
- Enum blocks are stateful: variant declarations are colored only inside an `enum`
  body, including `const enum`; payload field names are not enum members.
- F-string interpolation is tokenized as code while literal chunks stay strings, and
  `{{`/`}}` remain escapes.
- Unterminated one-line strings recover at the end of the line instead of consuming the
  rest of the file.
- Operators prefer the longest match (`..<`, `..`, `<<`, `<=`).
- The client legend now follows the server taxonomy order; a runtime mismatch marks the
  session degraded instead of silently mis-coloring.

### Performance

- Discovery is asynchronous and bounded: pure candidate construction, deduplication,
  bounded-concurrency probes, provenance labels, and successful-result caching.
- Crash recovery uses capped exponential backoff with a stability reset; no crash loops.
- Watch and release builds share one pipeline and ship the same bundled artifact.
- Recorded tokenization and discovery baselines live in
  [docs/performance.md](docs/performance.md).

### Compatibility

- Relative server paths resolve against the first workspace folder; `~` expands to the
  home directory.
- Untrusted workspaces do not auto-select nearby development builds.
- Automatic discovery runs only on macOS and Linux. Windows remains experimental and
  requires an explicit path.
- Multi-root workspaces share one session in this version.

### Known limitations

- Completion, rename, references, formatting, tasks, tests, and debugging are not
  advertised by this client release; only capabilities reported through `initialize`
  are shown in the health report.
- Installed-host theme verification and remote-host verification require a host matrix
  that is not part of this release.
