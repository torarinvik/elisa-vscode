import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import oniguruma from "vscode-oniguruma";
import vsctm from "vscode-textmate";

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const registryPromises = new Map();
let onigurumaPromise;

function loadOniguruma() {
  if (!onigurumaPromise) {
    onigurumaPromise = (async () => {
      const wasmPath = resolve(
        dirname(require.resolve("vscode-oniguruma")),
        "..",
        "release",
        "onig.wasm",
      );
      const wasm = readFileSync(wasmPath);
      await oniguruma.loadWASM(
        wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
      );
    })();
  }
  return onigurumaPromise;
}

async function loadRegistry(extensionRoot = projectRoot) {
  const root = resolve(extensionRoot);
  if (!registryPromises.has(root)) {
    registryPromises.set(root, (async () => {
      await loadOniguruma();
      const grammarPath = resolve(root, "syntaxes", "elisa.tmLanguage.json");
      return new vsctm.Registry({
        onigLib: Promise.resolve({
          createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
          createOnigString: (text) => new oniguruma.OnigString(text),
        }),
        loadGrammar: async (scopeName) => {
          if (scopeName !== "source.elisa") {
            return null;
          }
          return vsctm.parseRawGrammar(readFileSync(grammarPath, "utf8"), grammarPath);
        },
      });
    })());
  }
  return registryPromises.get(root);
}

export async function loadElisaGrammar(extensionRoot = projectRoot) {
  const registry = await loadRegistry(extensionRoot);
  const grammar = await registry.loadGrammar("source.elisa");
  if (!grammar) {
    throw new Error("failed to load the Elisa TextMate grammar");
  }
  return grammar;
}

export async function loadMarkdownGrammar(
  markdownGrammarPath,
  extensionRoot = projectRoot,
) {
  await loadOniguruma();
  const markdownHost = markdownGrammarPath
    ? vsctm.parseRawGrammar(
        readFileSync(markdownGrammarPath, "utf8"),
        markdownGrammarPath,
      )
    : {
        scopeName: "text.html.markdown",
        patterns: [
          { include: "#fencedCode" },
          { include: "#inlineCode" },
        ],
        repository: {
          fencedCode: {
            name: "markup.fenced_code.block.markdown",
            begin: "^ {0,3}(`{3,}|~{3,})[^\\n]*$",
            beginCaptures: {
              1: { name: "punctuation.definition.fenced.markdown" },
            },
            end: "^ {0,3}(`{3,}|~{3,})[ \\t]*$",
            endCaptures: {
              1: { name: "punctuation.definition.fenced.markdown" },
            },
            contentName: "markup.raw.block.markdown",
          },
          inlineCode: {
            name: "markup.inline.raw.string.markdown",
            begin: "`+",
            end: "`+",
          },
        },
      };
  const root = resolve(extensionRoot);
  const elisaPath = resolve(root, "syntaxes", "elisa.tmLanguage.json");
  const injectionPath = resolve(root, "syntaxes", "markdown-elisa.tmLanguage.json");
  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text) => new oniguruma.OnigString(text),
    }),
    getInjections: (scopeName) =>
      scopeName === "text.html.markdown" ? ["markdown.elisa.fenced-code"] : [],
    loadGrammar: async (scopeName) => {
      if (scopeName === "text.html.markdown") {
        return markdownHost;
      }
      if (scopeName === "markdown.elisa.fenced-code") {
        return vsctm.parseRawGrammar(readFileSync(injectionPath, "utf8"), injectionPath);
      }
      if (scopeName === "source.elisa") {
        return vsctm.parseRawGrammar(readFileSync(elisaPath, "utf8"), elisaPath);
      }
      return null;
    },
  });
  const grammar = await registry.loadGrammar("text.html.markdown");
  if (!grammar) {
    throw new Error("failed to load the Markdown host grammar");
  }
  return grammar;
}

export function tokenizeFile(grammar, text) {
  const lines = text.split("\n");
  let ruleStack = vsctm.INITIAL;
  const result = [];
  for (const line of lines) {
    const lineTokens = grammar.tokenizeLine(line, ruleStack);
    ruleStack = lineTokens.ruleStack;
    result.push(
      lineTokens.tokens.map((token) => ({
        text: line.slice(token.startIndex, token.endIndex),
        start: token.startIndex,
        scopes: token.scopes,
      })),
    );
  }
  return result;
}

export function tokenAt(lineTokens, text, occurrence = 0) {
  let seen = 0;
  for (const token of lineTokens) {
    if (token.text === text) {
      if (seen === occurrence) {
        return token;
      }
      seen += 1;
    }
  }
  return undefined;
}

export function hasScope(token, prefix) {
  return token !== undefined && token.scopes.some((scope) => scope.startsWith(prefix));
}

export function fixtureText(name) {
  return readFileSync(resolve(projectRoot, "test", "fixtures", "highlighting", name), "utf8");
}

export { projectRoot };
