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
    name: "Omni BYOK",
    family: "omni",
    version: "0.1.0",
    maxInputTokens: 64_000,
    maxOutputTokens: 8_000,
    capabilities: {
      toolCalling: true,
    },
    detail: "BYOK bridge model routed through Omni provider keys",
    tooltip: "Omni model bridge",
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

    const finalTranscript = toolContext
      ? [
          ...transcript,
          {
            role: "system" as const,
            content: `Tool result context: ${toolContext}`,
          },
        ]
      : transcript;

    // Stream directly into the progress reporter. Cancellation aborts the
    // upstream HTTP request so tokens stop flowing immediately rather than
    // just being dropped in-flight.
    try {
      await this.streamProvider(provider, finalTranscript, options, progress, token);
    } catch (error) {
      if (token.isCancellationRequested) {
        return;
      }
      const message = error instanceof Error ? error.message : "unknown error";
      progress.report(new vscode.LanguageModelTextPart(`\n[stream error] ${message}`));
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

  /**
   * Stream a response from the chosen provider directly into the VS Code
   * progress reporter. Unlike `callProvider`, this does not buffer the
   * entire response: tokens are forwarded as they arrive, and cancellation
   * aborts the HTTP request instead of merely dropping tail chunks.
   */
  private async streamProvider(
    provider: "openai" | "anthropic",
    transcript: TranscriptMessage[],
    options: ProviderCallOptions | undefined,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const emit = (chunk: string) => {
      if (!chunk) return;
      progress.report(new vscode.LanguageModelTextPart(chunk));
    };

    if (provider === "openai") {
      await this.streamOpenAI(transcript, options, emit, token);
      return;
    }
    await this.streamAnthropic(transcript, options, emit, token);
  }

  private async streamOpenAI(
    transcript: TranscriptMessage[],
    options: ProviderCallOptions | undefined,
    emit: (chunk: string) => void,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      emit("OpenAI API key is not configured in environment.");
      return;
    }

    const model = String(options?.modelOptions?.model ?? "gpt-4o-mini");
    const payload = {
      model,
      stream: true,
      temperature: Number(options?.modelOptions?.temperature ?? 0.2),
      messages: transcript.map((entry) => ({ role: entry.role, content: entry.content })),
    };

    const retry = this.readRetryOptions(options);
    const controller = new AbortController();
    const cancelDisposable = token.onCancellationRequested(() => controller.abort());

    try {
      const response = await this.fetchWithTimeout(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
        retry.timeoutMs,
      );

      if (!response.ok || !response.body) {
        const body = await response.text();
        emit(`OpenAI request failed (${response.status}): ${body.slice(0, 500)}`);
        return;
      }

      await this.readSseStream(response.body, (event) => {
        if (!event || event === "[DONE]") return;
        try {
          const parsed = JSON.parse(event) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) emit(delta);
        } catch {
          // Ignore keep-alive / malformed lines.
        }
      }, token);
    } finally {
      cancelDisposable.dispose();
    }
  }

  private async streamAnthropic(
    transcript: TranscriptMessage[],
    options: ProviderCallOptions | undefined,
    emit: (chunk: string) => void,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      emit("Anthropic API key is not configured in environment.");
      return;
    }

    const model = String(options?.modelOptions?.model ?? "claude-3-5-haiku-latest");
    const systemMessages = transcript.filter((entry) => entry.role === "system").map((entry) => entry.content);
    const nonSystem = transcript.filter((entry) => entry.role !== "system");

    const retry = this.readRetryOptions(options);
    const controller = new AbortController();
    const cancelDisposable = token.onCancellationRequested(() => controller.abort());

    try {
      const response = await this.fetchWithTimeout(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            model,
            stream: true,
            max_tokens: Number(options?.modelOptions?.max_tokens ?? 1024),
            temperature: Number(options?.modelOptions?.temperature ?? 0.2),
            system: systemMessages.join("\n\n") || undefined,
            messages: nonSystem.map((entry) => ({
              role: entry.role === "assistant" ? "assistant" : "user",
              content: entry.content,
            })),
          }),
          signal: controller.signal,
        },
        retry.timeoutMs,
      );

      if (!response.ok || !response.body) {
        const body = await response.text();
        emit(`Anthropic request failed (${response.status}): ${body.slice(0, 500)}`);
        return;
      }

      await this.readSseStream(response.body, (event) => {
        if (!event) return;
        try {
          const parsed = JSON.parse(event) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
            const text = parsed.delta.text;
            if (typeof text === "string" && text.length > 0) emit(text);
          }
        } catch {
          // Ignore keep-alive / ping events.
        }
      }, token);
    } finally {
      cancelDisposable.dispose();
    }
  }

  /**
   * Parse an `ReadableStream<Uint8Array>` SSE body into individual event
   * payload strings (the `data:` field). Handles multi-line `data:` fields
   * per the SSE spec. The caller is responsible for JSON-parsing events.
   */
  private async readSseStream(
    body: ReadableStream<Uint8Array>,
    onEvent: (event: string) => void,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    try {
      while (true) {
        if (token.isCancellationRequested) {
          await reader.cancel();
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        // Events are delimited by blank lines; support both \n\n and \r\n\r\n.
        while ((idx = this.findEventBoundary(buffer)) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx).replace(/^(\r?\n){1,2}/, "");
          const data = raw
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) onEvent(data);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private findEventBoundary(buffer: string): number {
    const nn = buffer.indexOf("\n\n");
    const rnrn = buffer.indexOf("\r\n\r\n");
    if (nn === -1) return rnrn;
    if (rnrn === -1) return nn;
    return Math.min(nn, rnrn);
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
    // If the caller already passed a signal (cancellation), merge it with
    // the timeout controller so either can abort the request.
    const callerSignal = init.signal as AbortSignal | undefined;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
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
