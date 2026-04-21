import { describe, expect, it } from "vitest";
import {
  buildIdeHost,
  buildLocalHost,
  createUniqueSlug,
  deriveDefaultNameFromPath,
  sanitizeSessionName,
} from "../../apps/desktop/src/main/workspaces/nameResolver";

describe("sanitizeSessionName", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(sanitizeSessionName("My Cool Project")).toBe("my-cool-project");
  });

  it("collapses repeated dashes and trims leading/trailing ones", () => {
    expect(sanitizeSessionName("--Hello___World--")).toBe("hello-world");
  });

  it("falls back to 'workspace' when input is empty", () => {
    expect(sanitizeSessionName("")).toBe("workspace");
    expect(sanitizeSessionName("!!!")).toBe("workspace");
  });
});

describe("deriveDefaultNameFromPath", () => {
  it("uses the final path segment", () => {
    expect(deriveDefaultNameFromPath("/Users/me/src/omni")).toBe("omni");
    expect(deriveDefaultNameFromPath("C:\\Users\\me\\src\\omni")).toBe("omni");
  });

  it("gracefully handles trailing slashes", () => {
    expect(deriveDefaultNameFromPath("/Users/me/src/omni/")).toBe("omni");
  });

  it("falls back when path is empty", () => {
    expect(deriveDefaultNameFromPath("")).toBe("workspace");
  });
});

describe("buildIdeHost / buildLocalHost", () => {
  it("appends the expected suffix", () => {
    expect(buildIdeHost("omni")).toBe("omni.ide");
    expect(buildLocalHost("omni")).toBe("omni.local");
  });
});

describe("createUniqueSlug", () => {
  it("returns the desired slug when no collision", () => {
    expect(createUniqueSlug("foo", new Set())).toBe("foo");
  });

  it("appends -2 on the first collision", () => {
    expect(createUniqueSlug("foo", new Set(["foo"]))).toBe("foo-2");
  });

  it("finds the next free suffix across multiple collisions", () => {
    expect(createUniqueSlug("foo", new Set(["foo", "foo-2", "foo-3"]))).toBe("foo-4");
  });
});
