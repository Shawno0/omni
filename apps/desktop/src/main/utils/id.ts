import crypto from "node:crypto";

export function createWorkspaceId(): string {
  return crypto.randomUUID();
}

export function createSessionToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}
