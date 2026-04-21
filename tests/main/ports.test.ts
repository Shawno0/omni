import { describe, expect, it, beforeEach } from "vitest";
import { allocatePort, releasePort, reservePort } from "../../apps/desktop/src/main/utils/ports";

// ports.ts keeps module-level state. These tests do not reset it between
// runs; instead they exercise the behavioural invariants we care about.

describe("allocatePort / releasePort", () => {
  it("returns a port inside the configured range", () => {
    const port = allocatePort();
    expect(port).toBeGreaterThanOrEqual(25_000);
    expect(port).toBeLessThanOrEqual(40_000);
    releasePort(port);
  });

  it("never hands out the same port twice while it is still reserved", () => {
    const first = allocatePort();
    const second = allocatePort();
    expect(first).not.toBe(second);
    releasePort(first);
    releasePort(second);
  });

  it("allows a released port to be re-allocated", () => {
    const port = allocatePort();
    releasePort(port);
    // Allocate a bunch until we cycle around — at some point we should see
    // the original port again (the allocator cycles through the range).
    let seenAgain = false;
    const allocated: number[] = [];
    for (let i = 0; i < 16_000 && !seenAgain; i++) {
      const next = allocatePort();
      allocated.push(next);
      if (next === port) seenAgain = true;
    }
    for (const value of allocated) releasePort(value);
    expect(seenAgain).toBe(true);
  });

  it("reservePort blocks a port from being allocated", () => {
    // Pick a predictable port well above the cursor range floor.
    const candidate = 39_999;
    reservePort(candidate);
    try {
      for (let i = 0; i < 100; i++) {
        const next = allocatePort();
        expect(next).not.toBe(candidate);
        releasePort(next);
      }
    } finally {
      releasePort(candidate);
    }
  });
});
