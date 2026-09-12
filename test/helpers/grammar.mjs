import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import oniguruma from "vscode-oniguruma";
import vsctm from "vscode-textmate";

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let registryPromise;

async function loadRegistry() {
  if (!registryPromise) {
    registryPromise = (async () => {
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
      const grammarPath = resolve(projectRoot, "syntaxes", "elisa.tmLanguage.json");
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
    })();
  }
  return registryPromise;
}

export async function loadElisaGrammar() {
  const registry = await loadRegistry();
  const grammar = await registry.loadGrammar("source.elisa");
  if (!grammar) {
    throw new Error("failed to load the Elisa TextMate grammar");
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
