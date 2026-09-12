import assert from "node:assert/strict";
import test from "node:test";
import sessionModule from "../out/serverSession.js";

const { ServerSession, SessionConnectError } = sessionModule;

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
      return {
        dispose() {
          listeners.delete(listener);
        },
      };
    },
    async stop() {
      stopCalls += 1;
      for (const listener of [...listeners]) {
        listener("stopped");
      }
    },
    emit(state) {
      for (const listener of [...listeners]) {
        listener(state);
      }
    },
  };
}

function harness(overrides = {}) {
  const clock = fakeClock();
  const states = [];
  const failures = [];
  const connections = [];
  const base = {
    discovery: { kind: "resolved", server: { executable: "/opt/elisa-lsp", source: "path", origin: "/opt" } },
    connectError: undefined,
    beforeResolve: undefined,
  };
  const config = { ...base, ...overrides };
  const hooks = {
    discover: async () => {
      if (config.beforeResolve) {
        await config.beforeResolve();
      }
      return config.discovery;
    },
    connect: async () => {
      if (config.connectError) {
        throw config.connectError;
      }
      const connection = fakeConnection();
      connections.push(connection);
      return connection;
    },
    log: () => undefined,
    onStateChange: (state) => states.push(state),
    onFailure: (failure) => failures.push(failure),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    policy: {
      maxRetries: 2,
      initialDelayMs: 100,
      maxDelayMs: 400,
      stabilityResetMs: 1000,
      ...overrides.policy,
    },
  };
  const session = new ServerSession(hooks);
  return { session, clock, states, failures, connections };
}

test("a successful start reaches ready and a stop reaches stopped", async () => {
  const { session, states, connections } = harness();
  await session.start();
  assert.equal(session.state, "ready");
  assert.deepEqual(states, ["resolving", "starting", "ready"]);
  assert.equal(session.resolvedServer.executable, "/opt/elisa-lsp");
  await session.stop();
  assert.equal(session.state, "stopped");
  assert.equal(connections[0].stopCalls(), 1);
});

test("an unusable explicit setting fails with invalid-configuration", async () => {
  const { session, failures } = harness({
    discovery: {
      kind: "invalid-explicit",
      setting: "elisa.languageServer.path",
      candidate: { path: "/bad", source: "setting", origin: "elisa.languageServer.path" },
      status: "not-executable",
    },
  });
  await session.start();
  assert.equal(session.state, "failed");
  assert.equal(failures[0].kind, "invalid-configuration");
});

test("a missing server fails with missing-server and stays lexical-only", async () => {
  const { session, failures } = harness({ discovery: { kind: "missing", probes: [] } });
  await session.start();
  assert.equal(session.state, "failed");
  assert.equal(failures[0].kind, "missing-server");
});

test("spawn failure and initialization failure are distinguished", async () => {
  const spawn = harness({ connectError: new SessionConnectError("no binary", "spawn") });
  await spawn.session.start();
  assert.equal(spawn.session.state, "failed");
  assert.equal(spawn.failures[0].kind, "spawn");

  const initialization = harness({
    connectError: new SessionConnectError("bad handshake", "initialization"),
  });
  await initialization.session.start();
  assert.equal(initialization.session.state, "failed");
  assert.equal(initialization.failures[0].kind, "initialization");
});

test("stopping during discovery never spawns a process", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { session, connections } = harness({
    beforeResolve: () => gate,
  });
  const start = session.start();
  await Promise.resolve();
  assert.equal(session.state, "resolving");
  const stop = session.stop();
  release();
  await Promise.all([start, stop]);
  assert.equal(session.state, "stopped");
  assert.equal(connections.length, 0);
});

test("stopping while starting tears down the partially created connection", async () => {
  let resolveConnect;
  const connection = fakeConnection();
  const clock = fakeClock();
  const session = new ServerSession({
    discover: async () => ({
      kind: "resolved",
      server: { executable: "/opt/elisa-lsp", source: "path", origin: "/opt" },
    }),
    connect: () =>
      new Promise((resolve) => {
        resolveConnect = () => resolve(connection);
      }),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const start = session.start();
  await Promise.resolve();
  await Promise.resolve();
  const stop = session.stop();
  resolveConnect();
  await Promise.all([start, stop]);
  assert.equal(session.state, "stopped");
  assert.equal(connection.stopCalls(), 1);
});

test("two concurrent restarts leave exactly one live connection", async () => {
  const { session, connections } = harness();
  await session.start();
  assert.equal(connections.length, 1);
  await Promise.all([session.restart(), session.restart()]);
  assert.equal(session.state, "ready");
  assert.equal(connections.length, 2);
  assert.equal(connections[0].stopCalls(), 1);
  assert.equal(connections[1].stopCalls(), 0);
  await session.stop();
  assert.equal(connections[1].stopCalls(), 1);
});

test("a process exit during a deliberate stop does not trigger crash backoff", async () => {
  const { session, clock, failures } = harness();
  await session.start();
  await session.stop();
  assert.equal(session.state, "stopped");
  assert.equal(clock.pending(), 0);
  assert.equal(failures.length, 0);
});

test("an unexpected exit restarts with bounded backoff and then fails", async () => {
  const { session, clock, states, failures, connections } = harness();
  await session.start();

  connections[0].emit("stopped");
  assert.equal(session.state, "degraded");
  assert.equal(clock.pending(), 1);
  await clock.advance(100);
  assert.equal(session.state, "ready");
  assert.equal(connections.length, 2);

  connections[1].emit("stopped");
  assert.equal(session.state, "degraded");
  await clock.advance(200);
  assert.equal(connections.length, 3);

  connections[2].emit("stopped");
  assert.equal(session.state, "failed");
  assert.equal(failures.at(-1).kind, "retries-exhausted");
  assert.equal(states.includes("failed"), true);
});

test("stability resets the retry budget", async () => {
  const { session, clock, connections } = harness();
  await session.start();
  await clock.advance(1000);

  connections[0].emit("stopped");
  assert.equal(session.state, "degraded");
  await clock.advance(100);
  assert.equal(connections.length, 2);

  await clock.advance(1000);
  connections[1].emit("stopped");
  await clock.advance(100);
  assert.equal(connections.length, 3, "retry budget was reset after stability");
});

test("a deliberate stop cancels a pending restart", async () => {
  const { session, clock, connections } = harness();
  await session.start();
  connections[0].emit("stopped");
  assert.equal(clock.pending(), 1);
  await session.stop();
  assert.equal(session.state, "stopped");
  assert.equal(clock.pending(), 0);
  await clock.advance(5000);
  assert.equal(connections.length, 1);
});

test("disposing twice is safe and stops once", async () => {
  const { session, connections } = harness();
  await session.start();
  await Promise.all([session.dispose(), session.dispose()]);
  assert.equal(session.state, "stopped");
  assert.equal(connections[0].stopCalls(), 1);
  await session.start();
  assert.equal(session.state, "stopped");
  assert.equal(connections.length, 1);
});

test("degraded and ready transitions are explicit", async () => {
  const { session } = harness();
  await session.start();
  session.markDegraded("missing capability");
  assert.equal(session.state, "degraded");
  session.markReady();
  assert.equal(session.state, "ready");
});
