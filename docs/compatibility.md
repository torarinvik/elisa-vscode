# Compatibility and support matrix

This matrix is evidence-based. A row is "supported" only when the extension suite, the
packaged VSIX smoke harness, and the sibling server suites have run on that combination.

| Component | Version / status | Evidence |
| --- | --- | --- |
| VS Code engine | `^1.85.0` declared; installed-host checks passed on 1.85.0 and 1.137.0 (macOS arm64) | Installed VSIX integration passed in trusted and Restricted Mode on both versions; full OS, remote, and theme matrix remains incomplete |
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

- Multi-root folders share one language server session; per-folder semantic isolation is
  not available. Different or invalid effective server executable paths block startup
  rather than silently selecting one folder's compiler. Keep the path identical across
  folders (or remove folder-specific overrides). With no explicit path, nearby/PATH
  discovery is evaluated independently for each root; the shared process starts only if
  every folder resolves to the same executable. Relative folder-specific paths resolve
  per folder; shared relative settings resolve from the first workspace root. Different
  trace settings disable tracing for the shared process. At most 32 roots are supported.
  Adding/removing a root restarts the server because dynamic root updates are not
  currently advertised.
- Semantic features advertised by the server are limited to those reported by
  `initialize`; the health report is the source of truth for a given build.
- Grammar fallback does not prove symbol identity. Qualified enum members and user
  types are colored only after semantic tokens arrive.
