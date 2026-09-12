# Troubleshooting

Work top to bottom. Each step produces evidence for the next; do not reinstall
components without evidence.

1. **Is the document language Elisa?**
   Check the status bar language mode. If it is Plain Text, the extension is not active
   in this host (wrong profile, remote vs local installation, or the file is not
   `.elisa`). Run **Elisa: Show Health Report** to see the editor host type.

2. **Is lexical highlighting present?**
   Comments, strings, and keywords should be colored immediately. If not, inspect the
   TextMate scopes with **Developer: Inspect Editor Tokens and Scopes**. If the scopes
   are missing, the packaged grammar is not registered; verify the VSIX contains
   `syntaxes/elisa.tmLanguage.json`.

3. **Is the server resolved?**
   Open **Elisa: Show Language Server Output**. The first lines record the selected
   executable and its source (setting, environment, nearby build, or PATH). If the
   setting is wrong, the extension reports it instead of silently choosing another
   binary. Use **Elisa: Configure Language Server** to select one.

4. **Did initialization succeed?**
   The output channel distinguishes resolution, spawn, and initialization failures. A
   spawn failure usually means the executable disappeared or is not executable. An
   initialization failure points at a protocol or compatibility problem.

5. **Does the server advertise the requested feature?**
   The health report lists advertised capabilities. If a feature is absent, that is a
   server limitation, not a theme or settings problem.

6. **Are semantic tokens returned for the exact occurrence?**
   If types and enum members stay uncolored while hover works, the server did not
   classify the occurrence. Capture the file region and report it.

7. **Are scopes correct but color absent?**
   Inspect the theme's semantic rules and your
   `editor.semanticTokenColorCustomizations`. The extension ships only conservative
   defaults; a theme may map a scope to a color equal to the background.

8. **Are results stale?**
   Semantic token result IDs, document versions, and session generations protect
   against stale publication. If you see stale results, note the document version and
   restart the server with **Elisa: Restart Language Server**.

## Protocol tracing

Message ordering, cancellation, or malformed-response problems need a protocol trace.
Set this **VS Code setting** and reload, or let the extension apply it live:

```json
"elisa.trace.server": "messages"
```

Use `"verbose"` only for short diagnostic sessions: it can include source code. The
trace appears in the **Elisa Language Server Trace** output channel. Set the value back
to `"off"` when finished.

## Support report

Run **Elisa: Collect Support Report** to preview a bounded, redacted report. Review it
before sharing; nothing is uploaded automatically. The report intentionally omits source
text, environment dumps, and private URLs.

## Workspace trust

In an untrusted workspace the extension does not run nearby builds automatically.
Explicit `elisa.languageServer.path` and `ELISA_LSP` still apply. Trusting the workspace
re-enables discovery of nearby development builds.
