# Compatibility and support matrix

This matrix is evidence-based. A row is "supported" only when the extension suite, the
packaged VSIX smoke harness, and the sibling server suites have run on that combination.

| Component | Version / status | Evidence |
| --- | --- | --- |
| VS Code engine | `^1.85.0` declared; latest stable at implementation time | CI runs the packaged extension suites; installed-host checks are manual |
| VS Code extension host | Desktop (supported), Remote (experimental), Web (grammar-only, not shipped) | Client decides `hostKind` and reports it in the health report |
| Extension build | TypeScript + esbuild bundle in `dist/extension.js` | `npm run compile`, `npm run audit:vsix` |
| Language server | Sibling `Elisa-LSP` build with matching semantic legend | Cross-repository legend validation test; `../Elisa-LSP/test/run_all.sh` |
| macOS | Supported (arm64 tested) | Baseline recorded in [baseline.md](baseline.md) |
| Linux | Supported by design; CI target | GitHub Actions build and test job |
| Windows | Experimental; server support unfinished | Discovery refuses automatic candidates on unsupported hosts; explicit paths only |
| Remote SSH / containers / WSL | Experimental | Server must run where the workspace lives; health report shows remote workspace host |
| Virtual workspaces / untitled | Untitled documents supported; virtual file systems untested | Document selector includes `untitled`; virtual workspaces are not advertised |

## Release channels

- `stable`: the normal VSIX produced by `npm run package`.
- `prerelease`: an explicitly labeled build when a measurement or compatibility change
  needs field validation.

## Upgrade and rollback

- Configuration is preserved across extension upgrades; there are no destructive
  migrations and no settings are rewritten.
- A server build that disagrees with the client legend is reported in the health report
  as a degraded session instead of applying misaligned tokens.
- Downgrades follow the same rule: the extension validates the legend at initialization
  and never rewrites server files.
- Caches are in-memory only; rollback cannot corrupt on-disk state.

## Known limitations

- Multi-root folders share one language server session in this version. A routing layer
  is planned; do not rely on per-folder server isolation yet.
- Semantic features advertised by the server are limited to those reported by
  `initialize`; the health report is the source of truth for a given build.
- Grammar fallback does not prove symbol identity. Qualified enum members and user
  types are colored only after semantic tokens arrive.
