import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import sessionModule from "../out/serverSession.js";

const { ServerSession } = sessionModule;

const idleScript =
  "setInterval(() => {}, 1000); process.on('SIGTERM', () => process.exit(0));";

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(handler, delayMs) {
      const id = nextId++;
      timers.set(id, { handler, at: now + delayMs });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    async advance(ms) {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= now)
        .sort((left, right) => left[1].at - right[1].at);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.handler();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error("condition was not met before the timeout");
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
}

function createHarness() {
  const clock = fakeClock();
  const children = [];
  const failures = [];
  const session = new ServerSession({
    discover: async () => ({
      kind: "resolved",
      server: { executable: "fake", source: "path", origin: "test" },
    }),
    connect: async () => {
      const child = spawn(process.execPath, ["-e", idleScript]);
      children.push(child);
      const listeners = new Set();
      const exited = new Promise((resolveExit) => child.on("close", resolveExit));
      child.on("close", () => {
        for (const listener of [...listeners]) {
          listener("stopped");
        }
      });
      await waitFor(() => child.pid !== undefined, 1000);
      return {
        onStateChange(listener) {
          listeners.add(listener);
          return { dispose: () => listeners.delete(listener) };
        },
        async stop() {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGTERM");
          }
          await exited;
        },
      };
    },
    log: () => undefined,
    onFailure: (failure) => failures.push(failure),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    policy: {
      maxRetries: 3,
      initialDelayMs: 50,
      maxDelayMs: 200,
      stabilityResetMs: 5000,
    },
  });
  return { session, clock, children, failures };
}

function isExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

test("real child processes spawn, restart after a crash, and are reaped", async () => {
  const { session, clock, children } = createHarness();
  await session.start();
  await waitFor(() => session.state === "ready" && children.length === 1);
  assert.equal(isExited(children[0]), false, "the first server process is alive");

  children[0].kill("SIGKILL");
  await waitFor(() => session.state === "degraded");
  await clock.advance(50);
  await waitFor(() => session.state === "ready" && children.length === 2);

  await session.dispose();
  await waitFor(() => children.every(isExited));
  assert.equal(
    children.every(isExited),
    true,
    "no process outlives the session",
  );
});

test("rapid restarts never leave more than one live process", async () => {
  const { session, children } = createHarness();
  await session.start();
  await waitFor(() => session.state === "ready" && children.length === 1);

  await Promise.all([session.restart(), session.restart()]);
  await waitFor(() => session.state === "ready");
  const live = children.filter((child) => !isExited(child));
  assert.equal(live.length, 1, `expected one live process but found ${live.length}`);

  await session.dispose();
  await waitFor(() => children.every(isExited));
});

test("stopping during startup leaves no live process", async () => {
  const { session, children } = createHarness();
  const start = session.start();
  const stop = session.stop();
  await Promise.all([start, stop]);
  assert.equal(session.state, "stopped");
  await waitFor(() => children.every(isExited));
});
