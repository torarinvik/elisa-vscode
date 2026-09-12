# Architecture decisions

Short records with alternatives, evidence, and reconsideration triggers. Format:
decision, context, alternatives, consequences.

## ADR 1 — Correctness gates before performance and features

**Decision.** Correctness is an eligibility constraint; performance is optimized only
within correct designs; productivity features ship only after their correctness and
latency gates.

**Alternatives.** Ship broad heuristic coloring quickly; treat performance as the only
gate; defer tests until after features.

**Consequences.** The lexical layer never guesses symbol identity. Unproven features are
not advertised. Some workflows stay uncolored until semantic tokens exist.

**Revisit when.** The compiler provides an occurrence stream rich enough to widen
lexical guarantees, or measured evidence shows a gate is stricter than user value.

## ADR 2 — Client decomposition and disposal ownership

**Decision.** `extension.ts` composes; discovery, session lifecycle, configuration,
health, and commands live in separate modules with injected external boundaries. The
`ServerSession` owns one start/stop promise pair and is the only component allowed to
spawn or stop a language client.

**Alternatives.** Keep all logic in `extension.ts`; introduce a service framework.

**Consequences.** Pure logic is unit-tested without VS Code. `deactivate` and the
session disposal share one stop path; races cannot orphan processes.

**Revisit when.** Multi-root routing requires per-folder sessions.

## ADR 3 — Discovery precedence, relative paths, and trust

**Decision.** Precedence is explicit setting, `ELISA_LSP`, nearby development build,
then `PATH`. A bad explicit value is an error, never a silent fallback. Relative paths
resolve against the first workspace folder; `~` expands to the home directory. Nearby
builds are skipped in untrusted workspaces and on unsupported hosts.

**Alternatives.** Silently fall through to PATH on a bad setting; treat nearby builds as
trusted tools; support environment-variable interpolation inside the setting.

**Consequences.** Failure messages stay actionable. Untrusted repositories cannot select
a local binary automatically.

**Revisit when.** The product ships managed server artifacts with signed provenance.

## ADR 4 — One session per workspace for now

**Decision.** The extension runs a single language server session for all workspace
folders and documents. Multi-root isolation is not advertised.

**Alternatives.** One process per folder immediately; one process per document (never
acceptable).

**Consequences.** Startup stays simple and measured; conflicting roots can share
semantics until routing exists. The compatibility page documents the limitation.

**Revisit when.** The server supports the required workspace model and many-root
measurements exist.

## ADR 5 — Legend and taxonomy are validated across repositories

**Decision.** The server's `docs/semantic-token-schema.json` legend is canonical. The
client's `semanticTokenTypes` must match it in order; a test fails on mismatch or on any
non-standard supertype. The client keeps the taxonomy mapping in `package.json` and
validates it rather than generating a second copy.

**Alternatives.** Hand-maintained parallel lists with no gate; generate the client
manifest at package time.

**Consequences.** Legend drift fails CI. Scope mappings remain explicit and
theme-tested.

**Revisit when.** The taxonomy grows enough that generation is safer than validation.

## ADR 6 — Conservative lexical fallback, exact semantic classification

**Decision.** The TextMate grammar classifies only context-provable categories
(declarations, variants inside `enum` blocks, type annotations, literals, operators).
Dotted PascalCase is not treated as an enum variant. Resolved identity comes from
semantic tokens.

**Alternatives.** Keep broad capitalization regexes for instant color.

**Consequences.** Negative controls (`raw.UiKey()`, `tool.Method(1)`) are never
miscolored. Qualified enum members wait for the server.

**Revisit when.** Grammar context can prove family identity without semantics (for
example, a fully stateful enum-scope model).

## ADR 7 — Watch and release builds share one pipeline

**Decision.** `scripts/build.mjs` performs type checking and bundling for both
`npm run compile` and `npm run watch`. Release packaging excludes `out/`, `src/`,
`test/`, `scripts/`, and all source maps; only `dist/extension.js` ships.

**Alternatives.** Keep `tsc --watch` alone; ship unbundled modules.

**Consequences.** Development and release execute the same bundle shape. Build inputs
cannot leak into the VSIX (audited in CI).

**Revisit when.** Build time or bundling constraints change.

## ADR 8 — Diagnostics, edits, and results are generation-aware

**Decision.** Results carry document versions and session generations; deliberate stops
are distinguished from crashes; crash recovery uses capped exponential backoff with a
stability reset. Stale results are invalidated rather than applied.

**Alternatives.** Optimistic reuse; unbounded restart loops.

**Consequences.** Interactive state stays predictable; failures end in a visible state
with a useful report.

**Revisit when.** The scheduler moves server-side and exposes explicit cancellation
semantics.

## ADR 9 — Logging, health, and privacy defaults

**Decision.** The output channel records concise lifecycle events. The health report
includes host, provenance, versions, state, capabilities, and the last failure. Support
reports redact home paths and are previewed before export; telemetry is absent; source
text, tokens, and environment dumps are never included by default.

**Alternatives.** Full environment dumps; automatic crash uploads.

**Consequences.** Users can diagnose setup without sharing source. Some investigations
need an explicit temporary trace mode.

**Revisit when.** An opt-in tracing design passes privacy review.

## ADR 10 — Platform and remote boundaries

**Decision.** Automatic discovery runs only on supported hosts (macOS, Linux). Windows
is experimental and explicit-path-only until server readiness and process behavior are
verified. Remote hosts use the extension-host environment; web support is grammar-only
and not shipped.

**Alternatives.** Advertise all platforms based on client filename logic.

**Consequences.** The compatibility page reflects tested reality.

**Revisit when.** The platform matrix has real evidence.
