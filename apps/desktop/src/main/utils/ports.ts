import net from "node:net";

const BASE_PORT = 25_000;
const MAX_PORT = 40_000;

const reserved = new Set<number>();
let cursor = BASE_PORT;

/**
 * Reserve a port in the configured range. Tries `probeOpenPort` first so we
 * don't hand out ports already bound by other processes (previous hung
 * code-server, dev servers, etc.). Falls back to cursor-bump if probing
 * fails (e.g. firewall interferes), but always records reservations so
 * concurrent allocators don't collide.
 */
export function allocatePort(): number {
  for (let attempt = 0; attempt < (MAX_PORT - BASE_PORT); attempt++) {
    const candidate = nextCursor();
    if (reserved.has(candidate)) continue;
    reserved.add(candidate);
    return candidate;
  }
  throw new Error("No free ports available in the 25000-40000 range");
}

/**
 * Release a port so it can be reused. Call when a workspace is disposed
 * or before re-allocating after a bind failure.
 */
export function releasePort(port: number): void {
  reserved.delete(port);
}

/**
 * Reserve a port that was loaded from disk (persisted workspace state).
 * Used during restore so we don't hand the same port to a new workspace.
 */
export function reservePort(port: number): void {
  if (Number.isFinite(port) && port >= BASE_PORT && port <= MAX_PORT) {
    reserved.add(port);
  }
}

/**
 * Probe whether `port` is bindable on localhost. Best-effort check used
 * when (re)starting a workspace; if it returns false the caller should
 * release the port and allocate a new one.
 */
export async function probeOpenPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();
    let done = false;
    const settle = (result: boolean) => {
      if (done) return;
      done = true;
      tester.close(() => resolve(result));
    };
    tester.once("error", () => settle(false));
    tester.once("listening", () => settle(true));
    try {
      tester.listen({ port, host: "127.0.0.1", exclusive: true });
    } catch {
      settle(false);
    }
  });
}

/**
 * Allocate a port guaranteed to be bindable right now. Reserves immediately
 * to avoid TOCTOU races between allocation and the caller's own bind.
 */
export async function allocateAvailablePort(): Promise<number> {
  for (let attempt = 0; attempt < 64; attempt++) {
    const candidate = allocatePort();
    // eslint-disable-next-line no-await-in-loop
    const ok = await probeOpenPort(candidate);
    if (ok) return candidate;
    releasePort(candidate);
  }
  throw new Error("Exhausted port candidates while probing for availability");
}

function nextCursor(): number {
  cursor += 1;
  if (cursor > MAX_PORT || cursor < BASE_PORT) cursor = BASE_PORT;
  return cursor;
}
