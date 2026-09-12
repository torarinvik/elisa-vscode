import assert from "node:assert/strict";
import test from "node:test";
import sessionModule from "../out/serverSession.js";

const { ServerSession } = sessionModule;

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
    pending: () => timers.size,
  };
}

function fakeConnection() {
  const listeners = new Set();
  let stopCalls = 0;
  return {
    stopCalls: () => stopCalls,
    onStateChange(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    async stop() {
      stopCalls += 1;
      for (const listener of [...listeners]) listener("stopped");
    },
    emit(state) {
      for (const listener of [...listeners]) listener(state);
    },
  };
}

test("two hundred crash/restart cycles leave no pending timers or live connections", async () => {
  const clock = fakeClock();
  const connections = [];
  const session = new ServerSession({
    discover: async () => ({
      kind: "resolved",
      server: { executable: "/opt/elisa-lsp", source: "path", origin: "/opt" },
    }),
    connect: async () => {
      const connection = fakeConnection();
      connections.push(connection);
      return connection;
    },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    policy: {
      maxRetries: 1000,
      initialDelayMs: 1,
      maxDelayMs: 4,
      stabilityResetMs: 10000,
    },
  });

  for (let cycle = 0; cycle < 200; cycle += 1) {
    if (session.state !== "ready") {
      await session.start();
    }
    const current = connections.at(-1);
    current.emit("stopped");
    await clock.advance(4);
  }

  await session.stop();
  assert.equal(session.state, "stopped");
  assert.equal(clock.pending(), 0, "no timers survive disposal");
  assert.equal(connections.at(-1).stopCalls(), 1, "the live connection was stopped");
  assert.equal(
    connections.every((connection) => connection.stopCalls() <= 1),
    true,
    "no connection was stopped more than once",
  );
  assert.ok(connections.length >= 200);
  await session.dispose();
  assert.equal(clock.pending(), 0);
});
