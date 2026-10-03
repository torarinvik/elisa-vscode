function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function assertJsonRpcResult(response, method) {
  if (!isRecord(response) || response.error !== undefined) {
    throw new Error(`${method} failed: ${JSON.stringify(response?.error ?? response)}`);
  }
  if (!Object.prototype.hasOwnProperty.call(response, "result")) {
    throw new Error(`${method} response has neither result nor error`);
  }
  return response.result;
}

export async function shutdownAndStop(client) {
  let shutdownError;
  try {
    const response = await client.request("shutdown");
    const result = assertJsonRpcResult(response, "shutdown");
    if (result !== null) {
      throw new Error("shutdown result must be null");
    }
  } catch (error) {
    shutdownError = error;
  }
  let exit;
  try {
    exit = await client.stop();
  } catch (error) {
    shutdownError ??= error;
  }
  if (shutdownError) {
    throw shutdownError;
  }
  if (!isRecord(exit) || exit.code !== 0 || exit.signal !== null) {
    throw new Error(`language server exited uncleanly after shutdown: ${JSON.stringify(exit)}`);
  }
}

export function assertSemanticTokensResponse(response, {
  source,
  tokenTypeCount,
  modifierCount,
} = {}) {
  if (typeof source !== "string") {
    throw new TypeError("semantic-token validation requires source text");
  }
  if (!Number.isSafeInteger(tokenTypeCount) || tokenTypeCount < 1) {
    throw new RangeError("tokenTypeCount must be a positive safe integer");
  }
  if (!Number.isSafeInteger(modifierCount) || modifierCount < 0 || modifierCount > 52) {
    throw new RangeError("modifierCount must be a safe integer between 0 and 52");
  }
  const result = assertJsonRpcResult(response, "textDocument/semanticTokens/full");
  if (!isRecord(result) || !Array.isArray(result.data) || result.data.length === 0 || result.data.length % 5 !== 0) {
    throw new Error("semantic-token result is not a non-empty five-integer record array");
  }
  if (result.data.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("semantic-token data contains a non-integer or negative value");
  }

  const lineLengths = source.split("\n").map((line) => line.length);
  const maximumModifierBits = 2 ** modifierCount - 1;
  let line = 0;
  let column = 0;
  let previousLine = -1;
  let previousEnd = 0;
  for (let index = 0; index < result.data.length; index += 5) {
    const [deltaLine, deltaColumn, length, tokenType, modifiers] = result.data.slice(index, index + 5);
    if (length === 0) {
      throw new Error(`semantic token ${index / 5} has an empty range`);
    }
    if (tokenType >= tokenTypeCount) {
      throw new Error(`semantic token ${index / 5} uses absent legend type ${tokenType}`);
    }
    if (modifiers > maximumModifierBits) {
      throw new Error(`semantic token ${index / 5} uses absent modifier bits`);
    }
    line += deltaLine;
    column = deltaLine === 0 ? column + deltaColumn : deltaColumn;
    if (line >= lineLengths.length || column + length > lineLengths[line]) {
      throw new Error(`semantic token ${index / 5} range is outside the source text`);
    }
    if (line === previousLine && column < previousEnd) {
      throw new Error(`semantic tokens overlap on source line ${line}`);
    }
    previousLine = line;
    previousEnd = column + length;
  }
}

export function assertHoverResponse(response, { allowNull = true } = {}) {
  const result = assertJsonRpcResult(response, "textDocument/hover");
  if (result === null) {
    if (!allowNull) {
      throw new Error("expected a hover result at the selected benchmark position");
    }
    return;
  }
  if (!isRecord(result) || !Object.prototype.hasOwnProperty.call(result, "contents")) {
    throw new Error("hover result must be null or an object containing contents");
  }
  const validContent = (content) => {
    if (typeof content === "string") {
      return true;
    }
    if (!isRecord(content) || typeof content.value !== "string") {
      return false;
    }
    return typeof content.language === "string" || content.kind === "markdown" || content.kind === "plaintext";
  };
  const contents = result.contents;
  if (!(validContent(contents) || (Array.isArray(contents) && contents.every(validContent)))) {
    throw new Error("hover contents do not match the LSP MarkedString/MarkupContent shape");
  }
}
