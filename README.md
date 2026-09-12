# Elisa Language Support for VSCode

This extension registers `.elisa` files, provides immediate TextMate syntax highlighting, and connects VSCode to the Elisa language server over stdio.

## Development

The extension looks for `elisa-lsp` in this order:

1. `elisa.languageServer.path` in VSCode settings.
2. `ELISA_LSP` in the extension host environment.
3. A nearby `Elisa-LSP/build/elisa-lsp` while walking the workspace and extension ancestors (including the sibling-project layout used by this repository).
4. `PATH`.

Build the sibling server with:

```sh
cd ../Elisa-LSP
bash build.sh
```

Then run `npm install` and press `F5` in this folder to launch an Extension Development Host. `npm run check` performs the strict TypeScript check; `npm run package` creates a VSIX.

The extension does not download or start a compiler implicitly. If no usable server is found, it reports the exact configuration path to fix.

To configure the server explicitly, open VSCode Settings JSON and add a property such as:

```json
"elisa.languageServer.path": "/Users/you/Documents/Coding Projects/Elisa Projects/Elisa-LSP/build/elisa-lsp"
```
