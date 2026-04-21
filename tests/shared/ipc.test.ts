import { describe, expect, it } from "vitest";
import { IpcChannels } from "@omni/shared";

describe("IpcChannels", () => {
  it("exposes all expected event channels", () => {
    expect(IpcChannels.EventWorkspacesUpdated).toBe("workspaces:updated");
    expect(IpcChannels.EventWorkspacePatch).toBe("workspace:patch");
    expect(IpcChannels.EventDeepLink).toBe("app:deepLink");
  });

  it("uses unique strings per channel", () => {
    const values = Object.values(IpcChannels);
    const deduped = new Set(values);
    expect(deduped.size).toBe(values.length);
  });

  it("never exposes a raw string that collides with an IPC namespace boundary", () => {
    for (const value of Object.values(IpcChannels)) {
      expect(value).toMatch(/^[a-z][a-zA-Z]*:[a-zA-Z][a-zA-Z:]*$/);
    }
  });
});
