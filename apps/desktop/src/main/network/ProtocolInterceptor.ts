import type { Session } from "electron";
import type { WorkspaceInfo } from "../types.js";

export interface ProtocolDiagnosticEvent {
  id: string;
  at: number;
  method: string;
  path: string;
  host: string;
  workspaceId?: string;
  routeType: "ide" | "app" | "passthrough";
  target?: string;
  status: number;
  ok: boolean;
  severity: "info" | "warning" | "error";
  error?: string;
}

export class ProtocolInterceptor {
  private readonly registered = new Set<string>();
  private readonly events: ProtocolDiagnosticEvent[] = [];
  private eventCounter = 0;
  private readonly maxEvents = 300;

  public ensureRegistered(session: Session, partitionKey: string, getWorkspaces: () => WorkspaceInfo[]): void {
    if (this.registered.has(partitionKey)) {
      return;
    }

    session.protocol.handle("http", async (request) => {
      const url = new URL(request.url);
      const host = url.hostname.toLowerCase();
      const workspace = getWorkspaces().find((candidate) => candidate.ideHost === host || candidate.appHost === host);

      if (!workspace) {
        try {
          const response = await fetch(request);
          this.record({
            method: request.method,
            path: url.pathname,
            host,
            routeType: "passthrough",
            status: response.status,
            ok: response.ok,
            severity: this.severityFor(response.status, response.ok),
          });
          return response;
        } catch (error) {
          this.record({
            method: request.method,
            path: url.pathname,
            host,
            routeType: "passthrough",
            status: 502,
            ok: false,
            severity: "error",
            error: error instanceof Error ? error.message : "Passthrough fetch failed",
          });
          return new Response("Passthrough request failed", { status: 502 });
        }
      }

      if (workspace.ideHost === host) {
        const target = new URL(request.url);
        target.hostname = "127.0.0.1";
        target.port = String(workspace.idePort);
        try {
          const response = await fetch(new Request(target.toString(), {
            method: request.method,
            headers: this.rewriteHeaders(request.headers, workspace.ideHost, `127.0.0.1:${workspace.idePort}`),
            body: request.body,
          }));
          this.record({
            method: request.method,
            path: url.pathname,
            host,
            workspaceId: workspace.id,
            routeType: "ide",
            target: target.toString(),
            status: response.status,
            ok: response.ok,
            severity: this.severityFor(response.status, response.ok),
          });
          return response;
        } catch (error) {
          this.record({
            method: request.method,
            path: url.pathname,
            host,
            workspaceId: workspace.id,
            routeType: "ide",
            target: target.toString(),
            status: 502,
            ok: false,
            severity: "error",
            error: error instanceof Error ? error.message : "Proxy request failed",
          });
          return new Response("Upstream IDE request failed", { status: 502 });
        }
      }

      if (!workspace.appPort) {
        this.record({
          method: request.method,
          path: url.pathname,
          host,
          workspaceId: workspace.id,
          routeType: "app",
          status: 503,
          ok: false,
          severity: "warning",
          error: "Workspace app port is not configured",
        });
        return new Response("Workspace app port is not configured", { status: 503 });
      }

      const target = new URL(request.url);
      target.hostname = "127.0.0.1";
      target.port = String(workspace.appPort);

      try {
        const response = await fetch(new Request(target.toString(), {
          method: request.method,
          headers: this.rewriteHeaders(request.headers, workspace.appHost, `127.0.0.1:${workspace.appPort}`),
          body: request.body,
        }));
        this.record({
          method: request.method,
          path: url.pathname,
          host,
          workspaceId: workspace.id,
          routeType: "app",
          target: target.toString(),
          status: response.status,
          ok: response.ok,
          severity: this.severityFor(response.status, response.ok),
        });
        return this.stripFrameBlockingHeaders(response);
      } catch (error) {
        this.record({
          method: request.method,
          path: url.pathname,
          host,
          workspaceId: workspace.id,
          routeType: "app",
          target: target.toString(),
          status: 502,
          ok: false,
          severity: "error",
          error: error instanceof Error ? error.message : "Proxy request failed",
        });
        return new Response("Upstream app request failed", { status: 502 });
      }
    });

    this.registered.add(partitionKey);
  }

  public getDiagnostics(limit = 80): ProtocolDiagnosticEvent[] {
    return this.events.slice(-Math.max(1, limit)).reverse();
  }

  private record(input: Omit<ProtocolDiagnosticEvent, "id" | "at">): void {
    this.eventCounter += 1;
    this.events.push({
      id: `evt_${this.eventCounter}`,
      at: Date.now(),
      ...input,
    });
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  /**
   * Strip headers that prevent the response from loading inside an iframe.
   * Upstream dev-servers (Next.js, Vite, etc.) commonly send
   * X-Frame-Options: SAMEORIGIN which blocks file:// → http:// embedding.
   */
  private stripFrameBlockingHeaders(response: Response): Response {
    const headers = new Headers(response.headers);
    headers.delete("x-frame-options");
    headers.delete("content-security-policy");
    headers.delete("content-security-policy-report-only");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  private rewriteHeaders(input: Headers, sourceHost: string, targetHost: string): Headers {
    const headers = new Headers(input);
    if (headers.get("host")?.includes(sourceHost)) {
      headers.set("host", targetHost);
    }
    if (headers.get("origin")?.includes(sourceHost)) {
      headers.set("origin", headers.get("origin")!.replace(sourceHost, targetHost));
    }
    if (headers.get("referer")?.includes(sourceHost)) {
      headers.set("referer", headers.get("referer")!.replace(sourceHost, targetHost));
    }
    return headers;
  }

  private severityFor(status: number, ok: boolean): "info" | "warning" | "error" {
    if (ok && status < 400) {
      return "info";
    }
    if (status >= 500) {
      return "error";
    }
    return "warning";
  }
}
