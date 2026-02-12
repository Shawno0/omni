interface PTYActivityBridgeOptions {
  activeWindowMs?: number;
  sampleIntervalMs?: number;
  onTerminalActivity: (workspaceId: string, active: boolean) => void;
}

export class PTYActivityBridge {
  private readonly activeWindowMs: number;
  private readonly sampleIntervalMs: number;
  private readonly lastOutputAt = new Map<string, number>();
  private readonly currentState = new Map<string, boolean>();
  private timer: NodeJS.Timeout | null = null;

  public constructor(private readonly options: PTYActivityBridgeOptions) {
    this.activeWindowMs = options.activeWindowMs ?? 4500;
    this.sampleIntervalMs = options.sampleIntervalMs ?? 900;
  }

  public start(): void {
    this.stop();
    this.timer = setInterval(() => {
      this.sweep();
    }, this.sampleIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public recordOutput(workspaceId: string): void {
    this.lastOutputAt.set(workspaceId, Date.now());
    if (this.currentState.get(workspaceId) !== true) {
      this.currentState.set(workspaceId, true);
      this.options.onTerminalActivity(workspaceId, true);
    }
  }

  public clear(workspaceId: string): void {
    this.lastOutputAt.delete(workspaceId);
    if (this.currentState.get(workspaceId)) {
      this.currentState.set(workspaceId, false);
      this.options.onTerminalActivity(workspaceId, false);
    }
  }

  private sweep(): void {
    const now = Date.now();

    for (const [workspaceId, active] of this.currentState.entries()) {
      const last = this.lastOutputAt.get(workspaceId) ?? 0;
      const shouldBeActive = now - last <= this.activeWindowMs;
      if (active !== shouldBeActive) {
        this.currentState.set(workspaceId, shouldBeActive);
        this.options.onTerminalActivity(workspaceId, shouldBeActive);
      }
    }

    for (const workspaceId of this.lastOutputAt.keys()) {
      if (!this.currentState.has(workspaceId)) {
        const last = this.lastOutputAt.get(workspaceId) ?? 0;
        const isActive = now - last <= this.activeWindowMs;
        this.currentState.set(workspaceId, isActive);
        this.options.onTerminalActivity(workspaceId, isActive);
      }
    }
  }
}
