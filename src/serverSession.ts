import type { DiscoveryOutcome, ServerResolution } from "./serverDiscovery";

export type SessionState =
  | "inactive"
  | "resolving"
  | "starting"
  | "ready"
  | "degraded"
  | "stopping"
  | "stopped"
  | "failed";

export type FailureKind =
  | "discovery"
  | "invalid-configuration"
  | "missing-server"
  | "spawn"
  | "initialization"
  | "crash"
  | "retries-exhausted";

export interface SessionFailure {
  readonly kind: FailureKind;
  readonly message: string;
  readonly detail?: string;
  readonly time: number;
}

export type ConnectionState = "starting" | "running" | "stopped";

export interface Disposable {
  dispose(): void;
}

export interface ServerConnection {
  readonly degradedReason?: string;
  onStateChange(listener: (state: ConnectionState) => void): Disposable;
  stop(): Promise<void>;
}

export interface RestartPolicy {
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly stabilityResetMs: number;
}

export const defaultRestartPolicy: RestartPolicy = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 8000,
  stabilityResetMs: 60000,
};

export interface SessionHooks {
  readonly discover: () => Promise<DiscoveryOutcome>;
  readonly connect: (server: ServerResolution) => Promise<ServerConnection>;
  readonly log?: (message: string) => void;
  readonly onStateChange?: (state: SessionState, previous: SessionState) => void;
  readonly onFailure?: (failure: SessionFailure) => void;
  readonly now?: () => number;
  readonly setTimer?: (handler: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly policy?: Partial<RestartPolicy>;
}

export class SessionConnectError extends Error {
  constructor(
    message: string,
    readonly phase: "spawn" | "initialization",
  ) {
    super(message);
    this.name = "SessionConnectError";
  }
}

type StateListener = (state: SessionState, previous: SessionState) => void;

export class ServerSession {
  private readonly policy: RestartPolicy;
  private readonly listeners = new Set<StateListener>();
  private stateValue: SessionState = "inactive";
  private failure: SessionFailure | undefined;
  private startPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;
  private connection: ServerConnection | undefined;
  private connectionListener: Disposable | undefined;
  private retryHandle: unknown;
  private stabilityHandle: unknown;
  private retries = 0;
  private restartPending = false;
  private deliberate = false;
  private disposed = false;
  private server: ServerResolution | undefined;

  constructor(private readonly hooks: SessionHooks) {
    this.policy = { ...defaultRestartPolicy, ...hooks.policy };
  }

  get state(): SessionState {
    return this.stateValue;
  }

  get lastFailure(): SessionFailure | undefined {
    return this.failure;
  }

  get resolvedServer(): ServerResolution | undefined {
    return this.server;
  }

  onDidChangeState(listener: StateListener): Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  start(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    if (
      !this.restartPending &&
      (this.stateValue === "ready" || this.stateValue === "degraded" || this.stateValue === "starting")
    ) {
      return Promise.resolve();
    }
    this.restartPending = false;
    this.cancelRetry();
    this.startPromise = this.runStart().finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  async stop(reason = "requested"): Promise<void> {
    if (this.stateValue === "inactive" || this.stateValue === "stopped") {
      return;
    }
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.deliberate = true;
    this.stopPromise = this.runStop(reason).finally(() => {
      this.stopPromise = undefined;
      this.deliberate = false;
    });
    return this.stopPromise;
  }

  async restart(): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.stop("restart");
    await this.start();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.stop("dispose");
    this.listeners.clear();
  }

  markDegraded(reason: string): void {
    if (this.stateValue === "ready") {
      this.hooks.log?.(`session degraded: ${reason}`);
      this.transition("degraded");
    }
  }

  markReady(): void {
    if (this.stateValue === "degraded") {
      this.transition("ready");
    }
  }

  private async runStart(): Promise<void> {
    this.transition("resolving");
    let outcome: DiscoveryOutcome;
    try {
      outcome = await this.hooks.discover();
    } catch (error) {
      this.fail("discovery", "Language server discovery failed", error);
      return;
    }

    if (this.deliberate || this.disposed) {
      this.transition("stopped");
      return;
    }

    if (outcome.kind === "invalid-explicit") {
      this.fail(
        "invalid-configuration",
        `${outcome.setting} points to a unusable language server`,
        `${outcome.candidate.path} (${outcome.status}${outcome.detail ? `: ${outcome.detail}` : ""})`,
      );
      return;
    }

    if (outcome.kind === "missing") {
      this.fail(
        "missing-server",
        "No Elisa language server was found",
        "Build Elisa-LSP or configure elisa.languageServer.path",
      );
      return;
    }

    this.server = outcome.server;
    this.transition("starting");
    let connection: ServerConnection;
    try {
      connection = await this.hooks.connect(outcome.server);
    } catch (error) {
      const phase = error instanceof SessionConnectError ? error.phase : "initialization";
      this.fail(phase, `Language server failed to ${phase}`, error);
      return;
    }

    if (this.deliberate || this.disposed) {
      await connection.stop().catch(() => undefined);
      this.transition("stopped");
      return;
    }

    this.connection = connection;
    this.connectionListener = connection.onStateChange((state) => {
      this.handleConnectionState(state);
    });
    this.armStabilityTimer();
    this.transition("ready");
    if (connection.degradedReason) {
      this.markDegraded(connection.degradedReason);
    }
  }

  private async runStop(reason: string): Promise<void> {
    this.transition("stopping");
    this.cancelRetry();
    this.cancelStability();
    const start = this.startPromise;
    if (start) {
      await start.catch(() => undefined);
    }
    this.connectionListener?.dispose();
    this.connectionListener = undefined;
    const connection = this.connection;
    this.connection = undefined;
    if (connection) {
      try {
        await connection.stop();
      } catch (error) {
        this.hooks.log?.(`error while stopping language server (${reason}): ${String(error)}`);
      }
    }
    this.transition("stopped");
  }

  private handleConnectionState(state: ConnectionState): void {
    if (this.deliberate || this.disposed || state !== "stopped") {
      return;
    }
    if (
      this.stateValue !== "starting" &&
      this.stateValue !== "ready" &&
      this.stateValue !== "degraded"
    ) {
      return;
    }
    this.connectionListener?.dispose();
    this.connectionListener = undefined;
    this.connection = undefined;
    this.cancelStability();
    this.recordFailure("crash", "Language server exited unexpectedly");
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.deliberate || this.disposed) {
      return;
    }
    if (this.retries >= this.policy.maxRetries) {
      this.recordFailure(
        "retries-exhausted",
        `Language server crashed ${this.policy.maxRetries} times; automatic restart disabled`,
      );
      this.transition("failed");
      return;
    }
    this.retries += 1;
    const delay = Math.min(
      this.policy.initialDelayMs * 2 ** (this.retries - 1),
      this.policy.maxDelayMs,
    );
    this.hooks.log?.(`restarting language server in ${delay} ms (attempt ${this.retries})`);
    this.transition("degraded");
    this.restartPending = true;
    this.retryHandle = this.setTimer(() => {
      this.retryHandle = undefined;
      void this.start();
    }, delay);
  }

  private armStabilityTimer(): void {
    this.cancelStability();
    if (this.policy.stabilityResetMs <= 0) {
      return;
    }
    this.stabilityHandle = this.setTimer(() => {
      this.stabilityHandle = undefined;
      if (this.stateValue === "ready" || this.stateValue === "degraded") {
        this.retries = 0;
      }
    }, this.policy.stabilityResetMs);
  }

  private cancelRetry(): void {
    if (this.retryHandle !== undefined) {
      this.clearTimer(this.retryHandle);
      this.retryHandle = undefined;
    }
    this.restartPending = false;
  }

  private cancelStability(): void {
    if (this.stabilityHandle !== undefined) {
      this.clearTimer(this.stabilityHandle);
      this.stabilityHandle = undefined;
    }
  }

  private setTimer(handler: () => void, delayMs: number): unknown {
    if (this.hooks.setTimer) {
      return this.hooks.setTimer(handler, delayMs);
    }
    return setTimeout(handler, delayMs);
  }

  private clearTimer(handle: unknown): void {
    if (this.hooks.clearTimer) {
      this.hooks.clearTimer(handle);
      return;
    }
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }

  private fail(kind: FailureKind, message: string, error?: unknown): void {
    this.recordFailure(kind, message, error);
    this.transition("failed");
  }

  private recordFailure(kind: FailureKind, message: string, error?: unknown): void {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : error === undefined
            ? undefined
            : String(error);
    const failure: SessionFailure = {
      kind,
      message,
      detail,
      time: this.hooks.now?.() ?? Date.now(),
    };
    this.failure = failure;
    this.hooks.log?.(`${message}${detail ? `: ${detail}` : ""}`);
    this.hooks.onFailure?.(failure);
  }

  private transition(next: SessionState): void {
    if (this.stateValue === next) {
      return;
    }
    const previous = this.stateValue;
    this.stateValue = next;
    this.hooks.onStateChange?.(next, previous);
    for (const listener of this.listeners) {
      listener(next, previous);
    }
  }
}
