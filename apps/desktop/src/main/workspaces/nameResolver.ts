const SLUG_SAFE = /[^a-z0-9-]/g;

export function sanitizeSessionName(name: string): string {
  const base = name.trim().toLowerCase().replace(/\s+/g, "-").replace(SLUG_SAFE, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return base || "workspace";
}

export function deriveDefaultNameFromPath(projectPath: string): string {
  const pathSegments = projectPath.replace(/\\/g, "/").split("/").filter(Boolean);
  const last = pathSegments[pathSegments.length - 1] ?? "workspace";
  return last;
}

export function buildIdeHost(slug: string): string {
  return `${slug}.ide`;
}

export function buildLocalHost(slug: string): string {
  return `${slug}.local`;
}

export function createUniqueSlug(desired: string, existing: Set<string>): string {
  if (!existing.has(desired)) {
    return desired;
  }

  let suffix = 2;
  while (existing.has(`${desired}-${suffix}`)) {
    suffix += 1;
  }

  return `${desired}-${suffix}`;
}
