import { spawn } from "node:child_process";

const defaultRequestTimeoutMs = 15000;
const defaultShutdownGraceMs = 500;
const maximumFrameBytes = 16 * 1024 * 1024;
const maximumHeaderBytes = 4096;
const maximumPendingRequests = 32;
const stderrTailBytes = 8192;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function createStdioClient(executable, args = [], options = {}) {
  const requestTimeoutMs = options.requestTimeoutMs ?? defaultRequestTimeoutMs;
  const shutdownGraceMs = options.shutdownGraceMs ?? defaultShutdownGraceMs;
  const frameLimit = options.maximumFrameBytes ?? maximumFrameBytes;
  const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"] });
  let buffer = Buffer.alloc(0);
  let stderrTail = Buffer.alloc(0);
  let failure;
  let closeResult;
  let nextId = 1;
  const pending = new Map();

  const closed = new Promise((resolveClosed) => {
    child.once("close", (code, signal) => {
      closeResult = { code, signal };
      const error = failure ?? new Error(
        `language server closed before answering requests (code ${code ?? "none"}, signal ${signal ?? "none"})${stderrTail.length > 0 ? `: ${stderrTail.toString("utf8")}` : ""}`,
      );
      for (const entry of pending.values()) {
        entry.reject(error);
      }
      pending.clear();
      resolveClosed(closeResult);
    });
  });

  const rejectPending = (error) => {
    if (!failure) {
      failure = error;
    }
    for (const entry of pending.values()) {
      entry.reject(failure);
    }
    pending.clear();
  };

  const fail = (error) => {
    rejectPending(error);
    if (!closeResult) {
      child.kill("SIGKILL");
    }
  };

  child.once("error", (error) => {
    rejectPending(error);
  });
  child.stdin.on("error", fail);
  child.stdout.on("error", fail);

  child.stderr.on("data", (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stderrTail = Buffer.concat([stderrTail, bytes]);
    if (stderrTail.length > stderrTailBytes) {
      stderrTail = stderrTail.subarray(stderrTail.length - stderrTailBytes);
    }
  });

  child.stdout.on("data", (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buffer.length + bytes.length > frameLimit + maximumHeaderBytes) {
      fail(new Error(`language server output exceeded ${frameLimit} bytes`));
      return;
    }
    buffer = Buffer.concat([buffer, bytes]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        if (buffer.length > maximumHeaderBytes) {
          fail(new Error("language server emitted an oversized or unterminated header"));
        }
        return;
      }
      if (headerEnd > maximumHeaderBytes) {
        fail(new Error("language server emitted an oversized protocol header"));
        return;
      }
      const header = buffer.subarray(0, headerEnd).toString("ascii");
      const match = /^Content-Length:\s*(\d+)\s*$/im.exec(header);
      const length = match ? Number(match[1]) : Number.NaN;
      if (!Number.isSafeInteger(length) || length < 0 || length > frameLimit) {
        fail(new Error("language server emitted an invalid or oversized Content-Length"));
        return;
      }
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) {
        return;
      }
      const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.subarray(bodyStart + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch (error) {
        fail(new Error(`language server emitted invalid JSON: ${errorMessage(error)}`));
        return;
      }
      if (message && message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id).resolve(message);
        pending.delete(message.id);
      }
    }
  });

  function frame(payload) {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    if (body.length > frameLimit) {
      throw new Error(`benchmark request exceeded ${frameLimit} bytes`);
    }
    return Buffer.concat([
      Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"),
      body,
    ]);
  }

  function send(payload) {
    if (failure) {
      throw failure;
    }
    if (closeResult) {
      throw new Error("language server is already closed");
    }
    child.stdin.write(frame(payload), (error) => {
      if (error) {
        fail(error);
      }
    });
  }

  function waitForClose(timeoutMs) {
    return new Promise((resolveClosed) => {
      const timer = setTimeout(() => resolveClosed(false), timeoutMs);
      closed.then(() => {
        clearTimeout(timer);
        resolveClosed(true);
      });
    });
  }

  return {
    request(method, params) {
      if (failure) {
        return Promise.reject(failure);
      }
      if (closeResult) {
        return Promise.reject(new Error("language server is already closed"));
      }
      if (pending.size >= maximumPendingRequests) {
        return Promise.reject(new Error("too many pending benchmark protocol requests"));
      }
      const id = nextId++;
      return new Promise((resolveRequest, rejectRequest) => {
        const timer = setTimeout(() => {
          const error = new Error(
            `language server request ${method} timed out after ${requestTimeoutMs} ms${stderrTail.length > 0 ? `: ${stderrTail.toString("utf8")}` : ""}`,
          );
          pending.delete(id);
          rejectRequest(error);
          fail(error);
        }, requestTimeoutMs);
        pending.set(id, {
          resolve: (message) => {
            clearTimeout(timer);
            resolveRequest(message);
          },
          reject: (error) => {
            clearTimeout(timer);
            rejectRequest(error);
          },
        });
        try {
          send({ jsonrpc: "2.0", id, method, params });
        } catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          rejectRequest(error);
          fail(error);
        }
      });
    },
    notify(method, params) {
      send({ jsonrpc: "2.0", method, params });
    },
    async stop() {
      if (!closeResult) {
        try {
          child.stdin.end(frame({ jsonrpc: "2.0", method: "exit" }));
        } catch {
          child.kill("SIGTERM");
        }
        const exited = await waitForClose(shutdownGraceMs);
        if (!exited && !closeResult) {
          child.kill("SIGTERM");
        }
      }
      if (!closeResult) {
        const exited = await waitForClose(shutdownGraceMs);
        if (!exited && !closeResult) {
          child.kill("SIGKILL");
        }
      }
      await closed;
      return closeResult;
    },
  };
}
