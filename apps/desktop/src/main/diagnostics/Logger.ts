import crypto from "node:crypto";
import type { OmniErrorRecord } from "@omni/shared";

export type OmniErrorListener = (events: OmniErrorRecord[]) => void;

/**
 * Central structured logger + ring buffer for user-visible errors.
 *
 * Main-process subsystems should call `logger.warn(...)` / `logger.error(...)`
 * with a stable `source` tag and a human-readable message. Events are fanned
 * out to:
 *   - stdout/stderr (console.*) for dev
 *   - a bounded ring buffer for the Issues toast rail in the renderer
 *   - subscribers (e.g. IPC broadcaster) that receive the full list on change
 *
 * Do NOT swallow errors silently — prefer logger.warn for recoverable issues
 * and logger.error for failures the user should see surfaced as a toast.
 */
export class Logger {
  private readonly events: OmniErrorRecord[] = [];
  private readonly subscribers = new Set<OmniErrorListener>();
  private counter = 0;

  public constructor(private readonly maxEvents = 200) {}

  public info(source: string, message: string, detail?: unknown): void {
    this.push("info", source, message, detail);
  }

  public warn(source: string, message: string, detail?: unknown): void {
    this.push("warn", source, message, detail);
  }

  public error(source: string, message: string, detail?: unknown): void {
    this.push("error", source, message, detail);
  }

  public list(limit = 60): OmniErrorRecord[] {
    return this.events.slice(-Math.max(1, limit)).reverse();
  }

  public subscribe(listener: OmniErrorListener): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  private push(level: OmniErrorRecord["level"], source: string, message: string, detail?: unknown): void {
    this.counter += 1;
    const detailStr = this.formatDetail(detail);
    const record: OmniErrorRecord = {
      id: `err_${this.counter}_${crypto.randomUUID().slice(0, 8)}`,
      at: Date.now(),
      level,
      source,
      message,
      ...(detailStr ? { detail: detailStr } : {}),
    };
    this.events.push(record);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    const line = `[${level}] ${source}: ${message}${record.detail ? ` — ${record.detail}` : ""}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);

    const snapshot = this.list();
    for (const sub of this.subscribers) {
      try {
        sub(snapshot);
      } catch {
        // Never let a listener break logging.
      }
    }
  }

  private formatDetail(detail: unknown): string | undefined {
    if (detail === undefined || detail === null) return undefined;
    if (detail instanceof Error) return detail.stack ?? detail.message;
    if (typeof detail === "string") return detail;
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  }
}

export const logger = new Logger();
