# Privacy and security

## Defaults

- No telemetry. The extension sends nothing to any service.
- No automatic uploads. Crash dumps and traces are never transmitted.
- No source text in logs, health reports, or support reports by default.
- No automatic toolchain downloads.

## Execution and trust

- The extension starts a native `elisa-lsp` process over stdio. That is code execution.
- In an untrusted workspace, nearby development builds are not selected automatically.
  Provide `elisa.languageServer.path` or `ELISA_LSP` to opt in explicitly.
- Source-controlled files are never executed to determine language support.
- Commands use direct process execution with argument arrays; the extension never
  constructs shell command strings from workspace or source content.

## Untrusted content

Hover and documentation content can contain attacker-controlled text. The client treats
server-provided Markdown as untrusted: no command links, no active HTML, no automatic
execution. Source-derived text is escaped before rendering.

## Support reports

**Elisa: Collect Support Report** builds a bounded report and opens it for review. It
redacts the home directory from paths and omits environment dumps, tokens, source
excerpts, and private URLs. Copying or sharing is always an explicit user action.

Health reports include: extension version and build identifier, editor host type,
platform, workspace count, trust state, server path source, lifecycle state, server
identity, negotiated encoding, advertised capabilities, last failure category, and
resource-limit state.

## Logging

Normal logs contain lifecycle events and actionable failures. Debug information such as
request timing can be enabled for local diagnosis. Full protocol tracing can contain
source code and is only acceptable as an explicit, temporary diagnostic mode; it is not
enabled by default.

## Reporting a vulnerability

Open a private security report with the maintainers rather than a public issue. Include
the build identifier from the health report and a minimal reproduction that does not
contain proprietary source.
