# Elisa Language Support for VS Code

Correctness-first language support for the Elisa programming language: immediate lexical
highlighting, then compiler-backed semantic classification through the Elisa language
server.

## Install and set up

- [Setting up the extension](docs/setting-up.md) — install, configure the server, and
  verify support.
- [Highlighting and themes](docs/highlighting.md) — what the lexical and semantic layers
  guarantee, and how to inspect scopes.
- [Troubleshooting](docs/troubleshooting.md) — the decision tree, health report, and
  support report.
- [Compatibility matrix](docs/compatibility.md) — supported hosts and known limits.

The extension never downloads a toolchain, never executes workspace-controlled commands
to discover language support, and never uploads source. In an untrusted workspace it
stays in lexical-only mode unless you provide an explicit server path.

## Commands

All commands live under the **Elisa** category in the Command Palette:

| Command | Purpose |
| --- | --- |
| Elisa: Restart Language Server | Orderly, idempotent restart |
| Elisa: Show Language Server Output | The extension's own lifecycle log |
| Elisa: Show Health Report | Host, provenance, versions, state, capabilities |
| Elisa: Verify Support | Runs a live semantic-token and hover check |
| Elisa: Configure Language Server | Select and validate an executable |
| Elisa: Explain Highlighting | Explain lexical vs semantic availability |
| Elisa: Collect Support Report | Preview a bounded, redacted report |

## Development

Prerequisites: Node 18+, npm, and `git`. The Elisa compiler and the sibling
`Elisa-LSP` checkout are needed only to build and test the server.

```sh
npm install
npm run compile   # typescript check + esbuild bundle to dist/extension.js
npm test          # real-grammar, discovery, lifecycle, config, and health tests
npm run watch     # shared watch pipeline for tsc and esbuild
npm run package   # compile + vsce package
```

Press `F5` to launch an Extension Development Host. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the test layers, fixture conventions, and release
checks.

## Repository layout

```text
src/        extension host code (composition, discovery, session, health, commands)
syntaxes/   TextMate grammar
docs/       user, contributor, and architecture documentation
test/       node:test suites plus highlighting fixtures
scripts/    unified build/watch pipeline
```
