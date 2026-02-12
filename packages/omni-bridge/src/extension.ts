import * as vscode from "vscode";

interface OmniTelemetryEvent {
  kind: "chat" | "tool";
  provider: "openai" | "anthropic";
  timestamp: number;
  meta?: Record<string, string | number | boolean>;
}

interface TranscriptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ProviderCallOptions {
  modelOptions?: { readonly [name: string]: unknown };
}

interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  timeoutMs: number;
}

class OmniBridgeProvider {
  private readonly output = vscode.window.createOutputChannel("Omni Bridge");
  private lastPtyHeartbeatAt = 0;
  private readonly ptyHeartbeatMinIntervalMs = 500;

  public readonly model: vscode.LanguageModelChatInformation = {
    id: "omni-context-default",
    name: "OmniContext BYOK",
    family: "omni",
    version: "0.1.0",
    maxInputTokens: 64_000,
    maxOutputTokens: 8_000,
    capabilities: {
      toolCalling: true,
    },
    detail: "BYOK bridge model routed through OmniContext provider keys",
    tooltip: "OmniContext model bridge",
  };

  public async sendChat(prompt: string): Promise<string> {
    const provider = this.resolveProvider();
    this.emitTelemetry({
      kind: "chat",
      provider,
      timestamp: Date.now(),
      meta: {
        chars: prompt.length,
      },
    });

    const transcript: TranscriptMessage[] = [
      {
        role: "user",
        content: prompt,
      },
    ];

    return this.callProvider(provider, transcript);
  }

  public async invokeTool(name: string, payload: unknown): Promise<unknown> {
    const provider = this.resolveProvider();
    this.emitTelemetry({
      kind: "tool",
      provider,
      timestamp: Date.now(),
      meta: {
        name,
        payloadType: typeof payload,
      },
    });

    return {
      ok: true,
      tool: name,
      echo: payload,
    };
  }

  public provideInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.LanguageModelChatInformation[]> {
    return [this.model];
  }

  public async provideResponse(
    _model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const provider = this.resolveProvider(options);
    const transcript = this.toTranscript(messages);
    const prompt = transcript.filter((entry) => entry.role === "user").map((entry) => entry.content).join("\n").trim();
    const tools = options.tools?.map((tool) => tool.name) ?? [];

    let toolContext = "";
    const requestedTool = this.parseToolDirective(prompt, tools);
    if (requestedTool) {
      try {
        const result = await vscode.lm.invokeTool(
          requestedTool.name,
          {
            input: requestedTool.input,
            toolInvocationToken: undefined,
          },
          token,
        );
        toolContext = this.languageModelToolResultToText(result);
        this.emitTelemetry({
          kind: "tool",
          provider,
          timestamp: Date.now(),
          meta: {
            invokedTool: requestedTool.name,
            resultChars: toolContext.length,
          },
        });
      } catch (error) {
        toolContext = `Tool invocation failed for ${requestedTool.name}: ${error instanceof Error ? error.message : "unknown error"}`;
      }
    }

    if (tools.length > 0) {
      this.emitTelemetry({
        kind: "tool",
        provider,
        timestamp: Date.now(),
        meta: {
          availableTools: tools.join(","),
          toolMode: options.toolMode,
        },
      });
    }

    this.emitTelemetry({
      kind: "chat",
      provider,
      timestamp: Date.now(),
      meta: {
        chars: prompt.length,
        messageCount: messages.length,
      },
    });

    const response = await this.callProvider(
      provider,
      toolContext
        ? [
            ...transcript,
            {
              role: "system",
              content: `Tool result context: ${toolContext}`,
            },
          ]
        : transcript,
      options,
    );

    const chunks = this.chunk(response, 80);
    for (const chunk of chunks) {
      if (token.isCancellationRequested) {
        break;
      }
      progress.report(new vscode.LanguageModelTextPart(chunk));
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
  }

  public async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    if (typeof text === "string") {
      return text.length;
    }

    const parts = "content" in text && Array.isArray((text as { content: readonly unknown[] }).content)
      ? (text as { content: readonly unknown[] }).content
      : [];
    return parts
      .filter((part) => part instanceof vscode.LanguageModelTextPart)
      .map((part) => (part as vscode.LanguageModelTextPart).value.length)
      .reduce((total, length) => total + length, 0);
  }

  public registerTerminalHeartbeat(context: vscode.ExtensionContext): void {
    const workspaceId = process.env.OMNI_WORKSPACE_ID?.trim();
    const endpoint = process.env.OMNI_PTY_HEARTBEAT_URL?.trim();

    if (!workspaceId || !endpoint) {
      return;
    }

    const terminalDataAPI = vscode.window as typeof vscode.window & {
      onDidWriteTerminalData?: (listener: (event: unknown) => void) => vscode.Disposable;
    };

    if (typeof terminalDataAPI.onDidWriteTerminalData !== "function") {
      this.output.appendLine("[pty] onDidWriteTerminalData API unavailable; PTY heartbeat disabled");
      return;
    }

    const subscription = terminalDataAPI.onDidWriteTerminalData(() => {
      const now = Date.now();
      if (now - this.lastPtyHeartbeatAt < this.ptyHeartbeatMinIntervalMs) {
        return;
      }

      this.lastPtyHeartbeatAt = now;
      void this.sendPtyHeartbeat(endpoint, workspaceId);
    });

    context.subscriptions.push(subscription);
    this.output.appendLine("[pty] terminal heartbeat bridge enabled");
  }

  private chunk(input: string, size: number): string[] {
    const chunks: string[] = [];
    for (let index = 0; index < input.length; index += size) {
      chunks.push(input.slice(index, index + size));
    }
    return chunks;
  }

  private resolveProvider(options?: vscode.ProvideLanguageModelChatResponseOptions): "openai" | "anthropic" {
    const desired = String(options?.modelOptions?.provider ?? "").trim().toLowerCase();
    if (desired === "openai" && process.env.OPENAI_API_KEY) {
      return "openai";
    }
    if (desired === "anthropic" && process.env.ANTHROPIC_API_KEY) {
      return "anthropic";
    }
    if (process.env.OPENAI_API_KEY) {
      return "openai";
    }
    return "anthropic";
  }

  private toTranscript(messages: readonly vscode.LanguageModelChatRequestMessage[]): TranscriptMessage[] {
    return messages
      .map((message) => {
        const role = this.normalizeRole(message.role);
        const content = (message.content ?? [])
          .map((part) => this.requestPartToText(part))
          .filter(Boolean)
          .join("\n")
          .trim();
        return { role, content };
      })
      .filter((entry) => entry.content.length > 0);
  }

  private normalizeRole(role: vscode.LanguageModelChatMessageRole): TranscriptMessage["role"] {
    if (role === vscode.LanguageModelChatMessageRole.Assistant) {
      return "assistant";
    }
    if (role === vscode.LanguageModelChatMessageRole.User) {
      return "user";
    }
    return "system";
  }

  private requestPartToText(part: unknown): string {
    if (part instanceof vscode.LanguageModelTextPart) {
      return part.value;
    }
    if (part instanceof vscode.LanguageModelToolResultPart) {
      return this.languageModelToolResultToText(part.content);
    }
    if (typeof part === "string") {
      return part;
    }
    if (part && typeof part === "object" && "value" in part && typeof (part as { value: unknown }).value === "string") {
      return (part as { value: string }).value;
    }
    if (part && typeof part === "object" && "text" in part && typeof (part as { text: unknown }).text === "string") {
      return (part as { text: string }).text;
    }
    return JSON.stringify(part);
  }

  private languageModelToolResultToText(result: vscode.LanguageModelToolResult | readonly unknown[]): string {
    const parts = Array.isArray(result)
      ? result
      : ("content" in result && Array.isArray(result.content) ? result.content : []);

    return parts
      .map((part: unknown) => {
        if (part instanceof vscode.LanguageModelTextPart) {
          return part.value;
        }
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "value" in part && typeof (part as { value: unknown }).value === "string") {
          return (part as { value: string }).value;
        }
        return JSON.stringify(part);
      })
      .join("\n");
  }

  private parseToolDirective(prompt: string, availableTools: string[]): { name: string; input: object } | undefined {
    if (availableTools.length === 0) {
      return undefined;
    }

    const match = /@tool\s+([a-zA-Z0-9._-]+)(?:\s+(\{[\s\S]*\}))?/.exec(prompt);
    if (!match) {
      return undefined;
    }

    const toolName = match[1];
    if (!toolName || !availableTools.includes(toolName)) {
      return undefined;
    }

    const rawInput = match[2]?.trim();
    if (!rawInput) {
      return { name: toolName, input: {} };
    }

    try {
      const parsed = JSON.parse(rawInput);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { name: toolName, input: parsed as object };
      }
      return { name: toolName, input: { value: parsed } };
    } catch {
      return { name: toolName, input: { raw: rawInput } };
    }
  }

  private async callProvider(
    provider: "openai" | "anthropic",
    transcript: TranscriptMessage[],
    options?: ProviderCallOptions,
  ): Promise<string> {
    if (provider === "openai") {
      return this.callOpenAI(transcript, options);
    }
    return this.callAnthropic(transcript, options);
  }

  private async callOpenAI(
    transcript: TranscriptMessage[],
    options?: ProviderCallOptions,
  ): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return "OpenAI API key is not configured in environment.";
    }

    const model = String(options?.modelOptions?.model ?? "gpt-4o-mini");
    const payload = {
      model,
      temperature: Number(options?.modelOptions?.temperature ?? 0.2),
      messages: transcript.map((entry) => ({
        role: entry.role,
        content: entry.content,
      })),
    };

    const retry = this.readRetryOptions(options);
    const response = await this.fetchWithRetry(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      retry,
    );

    if (!response.ok) {
      const body = await response.text();
      return `OpenAI request failed (${response.status}): ${body.slice(0, 500)}`;
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return body.choices?.[0]?.message?.content?.trim() || "OpenAI returned an empty response.";
  }

  private async callAnthropic(
    transcript: TranscriptMessage[],
    options?: ProviderCallOptions,
  ): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return "Anthropic API key is not configured in environment.";
    }

    const model = String(options?.modelOptions?.model ?? "claude-3-5-haiku-latest");
    const systemMessages = transcript.filter((entry) => entry.role === "system").map((entry) => entry.content);
    const nonSystem = transcript.filter((entry) => entry.role !== "system");

    const retry = this.readRetryOptions(options);
    const response = await this.fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: Number(options?.modelOptions?.max_tokens ?? 1024),
          temperature: Number(options?.modelOptions?.temperature ?? 0.2),
          system: systemMessages.join("\n\n") || undefined,
          messages: nonSystem.map((entry) => ({
            role: entry.role === "assistant" ? "assistant" : "user",
            content: entry.content,
          })),
        }),
      },
      retry,
    );

    if (!response.ok) {
      const body = await response.text();
      return `Anthropic request failed (${response.status}): ${body.slice(0, 500)}`;
    }

    const body = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = body.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").trim();
    return text || "Anthropic returned an empty response.";
  }

  private readRetryOptions(options?: ProviderCallOptions): RetryOptions {
    return {
      attempts: Math.max(1, Number(options?.modelOptions?.retry_attempts ?? 2)),
      baseDelayMs: Math.max(150, Number(options?.modelOptions?.retry_base_delay_ms ?? 350)),
      timeoutMs: Math.max(1000, Number(options?.modelOptions?.timeout_ms ?? 30_000)),
    };
  }

  private async fetchWithRetry(url: string, init: RequestInit, retry: RetryOptions): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(url, init, retry.timeoutMs);
        if (response.status >= 500 && attempt < retry.attempts) {
          await this.delay(retry.baseDelayMs * attempt);
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt < retry.attempts) {
          await this.delay(retry.baseDelayMs * attempt);
          continue;
        }
      }
    }

    throw new Error(lastError instanceof Error ? lastError.message : "Request failed after retries");
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private emitTelemetry(event: OmniTelemetryEvent): void {
    this.output.appendLine(`[telemetry] ${JSON.stringify(event)}`);
  }

  private async sendPtyHeartbeat(endpoint: string, workspaceId: string): Promise<void> {
    try {
      const token = process.env.OMNI_PTY_HEARTBEAT_TOKEN?.trim();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (token) {
        headers["x-omni-heartbeat-token"] = token;
      }

      await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          workspaceId,
          at: Date.now(),
        }),
      });
    } catch {
      return;
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const omniBridge = new OmniBridgeProvider();
  omniBridge.registerTerminalHeartbeat(context);

  const lmRegistration = vscode.lm.registerLanguageModelChatProvider("omni-bridge", {
    provideLanguageModelChatInformation: (options, token) => omniBridge.provideInformation(options, token),
    provideLanguageModelChatResponse: (model, messages, options, progress, token) =>
      omniBridge.provideResponse(model, messages, options, progress, token),
    provideTokenCount: (model, text, token) => omniBridge.provideTokenCount(model, text, token),
  });

  const askCommand = vscode.commands.registerCommand("omniBridge.ask", async () => {
    const prompt = await vscode.window.showInputBox({
      prompt: "Ask Omni Bridge",
      placeHolder: "Summarize current TODO list",
    });

    if (!prompt) {
      return;
    }

    const response = await omniBridge.sendChat(prompt);
    void vscode.window.showInformationMessage(response);
  });

  const toolCommand = vscode.commands.registerCommand("omniBridge.toolCall", async () => {
    const output = await omniBridge.invokeTool("workspace.list", { source: "command" });
    void vscode.window.showInformationMessage(`Tool call result: ${JSON.stringify(output)}`);
  });

  context.subscriptions.push(lmRegistration, askCommand, toolCommand);
}

export function deactivate(): void {
  // no-op
}
