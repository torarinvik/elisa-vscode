# Highlighting and themes

Elisa highlighting has two layers with different truth guarantees.

## Lexical layer (always available)

The packaged TextMate grammars classify what the token stream alone can know:

- comments, strings, f-string interpolations, numbers, operators, punctuation;
- declaration keywords and names, including modules, structs, enums, constants, and
  functions;
- enum variant declarations inside an `enum` block;
- type annotations after `:`, `->`, `as`, and `is`.

The lexical layer deliberately does **not** guess symbol identity. `raw.UiKey()`,
`tool.Method(1)`, and `Family.Variant` are not colored as enum members just because a
name follows a dot. That correctness comes from the semantic layer.

Markdown files support lexical Elisa highlighting in top-level backtick or tilde fences
of three or more markers whose info string begins with `elisa` (case-insensitive;
optional metadata is allowed). Other languages, prose, and inline code are left to the
Markdown grammar. This is grammar-only embedding: the language server intentionally does
not receive or parse the whole Markdown host document, so semantic tokens, diagnostics,
hover, and navigation are currently available only in standalone Elisa documents.

## Semantic layer (after the server is ready)

For standalone Elisa documents, the language server returns semantic tokens derived from
compiler analysis:
resolved user types, exact enum families and variants in declarations, constructions,
and patterns, function definitions and uses, parameters, fields, globals, effects, and
operators. Semantic tokens override lexical scopes.

If the two layers disagree, the semantic layer wins. Semantic tokens are unavailable
while the server is missing, crashed, or still starting; lexical highlighting remains.

## Inspecting scopes

1. Open the Command Palette and run **Developer: Inspect Editor Tokens and Scopes**.
2. Click a token. The panel shows TextMate scopes and, below, the semantic token type
   and modifiers.

Use this to tell the difference between "the grammar has no scope" and "the theme has
no rule for the scope".

## Themes

The extension does not force a palette. It declares standard supertype fallbacks for
every custom `elisa-*` semantic token type, so themes that color `type`, `enumMember`,
`function`, `parameter`, `property`, `keyword`, `operator`, and friends color Elisa too.

The extension does not force any color. Each custom `elisa-*` type declares a TextMate
scope mapping, so a theme that colors those scopes colors Elisa without extra rules.
The old dotted LSP type names remain mapped as compatibility aliases while existing
language-server builds are upgraded.
If you want specific colors, set them yourself as a user choice, per theme or globally:

```json
"editor.semanticTokenColorCustomizations": {
  "rules": {
    "elisa-type-user": { "foreground": "#4EC9B0", "bold": false },
    "elisa-enum-variant": { "foreground": "#C586C0" }
  }
}
```

Light, dark, and high-contrast themes are expected to remain readable because
fallbacks rely on standard token categories rather than a fixed color.
