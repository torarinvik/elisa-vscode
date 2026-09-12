# Setting up Elisa language support

This page is for using the extension in VS Code. Development instructions live in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## 1. Install the extension

Install `elisa-vscode` from a VSIX (or the marketplace when published). The extension
activates when you open a `.elisa` file. It provides TextMate highlighting immediately,
even before a language server is available.

## 2. Provide the language server

The extension looks for `elisa-lsp` in this order:

1. The `elisa.languageServer.path` VS Code setting.
2. The `ELISA_LSP` environment variable of the extension host.
3. A nearby development build, for trusted workspaces only:
   `build/elisa-lsp` or `Elisa-LSP/build/elisa-lsp` in an ancestor directory.
4. `elisa-lsp` on `PATH`.

If none are usable, Elisa remains in lexical-only mode and offers setup actions.

### Option A: select a server with the UI

Run **Elisa: Configure Language Server** from the Command Palette, choose the
executable, confirm where the setting is written, and let the extension restart.

### Option B: set the setting by hand

Open **Settings JSON** (Command Palette: *Preferences: Open User Settings (JSON)*) and add
a **VS Code setting** such as:

```json
"elisa.languageServer.path": "/Users/you/Documents/Coding Projects/Elisa Projects/Elisa-LSP/build/elisa-lsp"
```

That is settings JSON, **not a terminal command**. Do not paste it into a shell.
Relative paths resolve against the first workspace folder; a leading `~` means your
home directory.

The same path can be provided through the environment variable of the extension host
(for example a remote host), as a **shell environment variable**:

```sh
export ELISA_LSP="/opt/elisa/bin/elisa-lsp"
```

### Option C: build the sibling server

These commands run in a **terminal**, not in settings:

```sh
cd "/Users/you/Documents/Coding Projects/Elisa Projects/Elisa-LSP"
bash build.sh
bash test/run_all.sh
```

## 3. Verify support

1. Open an `.elisa` file and confirm the language mode in the status bar says **Elisa**.
2. Run **Elisa: Show Health Report**. It lists the server path source, lifecycle state,
   negotiated encoding, and advertised capabilities.
3. Hover a symbol and check that semantic tokens appear (for example `Event.Resize`).
4. If something is missing, run **Elisa: Show Language Server Output** and read the
   lifecycle log.

## 4. Normal editor versus Extension Development Host

- **Normal editor**: the installed extension runs from `dist/extension.js` inside the
  packaged VSIX. This is what users run.
- **Extension Development Host**: press `F5` in the `elisa-vscode` repository. It loads
  the workspace build. Use it for development only.

The two paths share the same build pipeline, but a development host can see local files
that a packaged install cannot.

## 5. Troubleshooting route

Follow the decision tree in [troubleshooting.md](troubleshooting.md). Prefer the health
report and output channel before reinstalling anything.
