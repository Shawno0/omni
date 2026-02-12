import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

interface PTYHeartbeatServerOptions {
  onHeartbeat: (workspaceId: string) => void;
  validateToken?: (workspaceId: string, token: string | undefined) => boolean;
}

export class PTYHeartbeatServer {
  private server: Server | null = null;
  private endpoint: string | null = null;

  public constructor(private readonly options: PTYHeartbeatServerOptions) {}

  public async start(): Promise<string> {
    if (this.server && this.endpoint) {
      return this.endpoint;
    }

    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });

    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("PTY heartbeat server failed to bind");
    }

    const port = (address as AddressInfo).port;
    this.endpoint = `http://127.0.0.1:${port}/pty-activity`;
    return this.endpoint;
  }

  public stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.endpoint = null;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST" || request.url !== "/pty-activity") {
      response.statusCode = 404;
      response.end();
      return;
    }

    const payload = await this.readJsonBody(request);
    if (!payload || typeof payload.workspaceId !== "string" || payload.workspaceId.trim().length === 0) {
      response.statusCode = 400;
      response.end();
      return;
    }

    const workspaceId = payload.workspaceId.trim();
    const tokenHeader = request.headers["x-omni-heartbeat-token"];
    const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    const valid = this.options.validateToken ? this.options.validateToken(workspaceId, token) : true;

    if (!valid) {
      response.statusCode = 403;
      response.end();
      return;
    }

    this.options.onHeartbeat(workspaceId);
    response.statusCode = 204;
    response.end();
  }

  private async readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | null> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (chunks.reduce((size, item) => size + item.length, 0) > 16 * 1024) {
        return null;
      }
    }

    try {
      const text = Buffer.concat(chunks).toString("utf8");
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}