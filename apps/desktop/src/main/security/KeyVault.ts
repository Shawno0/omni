import fs from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import { AI_PROVIDERS, type AiProvider } from "@omni/shared";

type Provider = AiProvider;

interface StoredKey {
  provider: Provider;
  encrypted: string;
  updatedAt: number;
}

interface StoredPayload {
  keys: Partial<Record<Provider, StoredKey | undefined>>;
}

export class KeyVault {
  private readonly filePath = path.join(app.getPath("userData"), "omni-keys.json");

  public async list(): Promise<Array<{ provider: Provider; maskedValue: string; updatedAt: number }>> {
    const payload = await this.read();
    return (Object.values(payload.keys).filter(Boolean) as StoredKey[]).map((entry) => ({
      provider: entry.provider,
      maskedValue: "••••••••" + this.peekLast(entry),
      updatedAt: entry.updatedAt,
    }));
  }

  public async set(provider: Provider, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS encryption is not available");
    }

    const payload = await this.read();
    const encrypted = safeStorage.encryptString(value).toString("base64");
    payload.keys[provider] = {
      provider,
      encrypted,
      updatedAt: Date.now(),
    };
    await this.write(payload);
  }

  public async delete(provider: Provider): Promise<void> {
    const payload = await this.read();
    payload.keys[provider] = undefined;
    await this.write(payload);
  }

  public async getDecrypted(provider: Provider): Promise<string | undefined> {
    const payload = await this.read();
    const entry = payload.keys[provider];
    if (!entry) {
      return undefined;
    }

    const buffer = Buffer.from(entry.encrypted, "base64");
    return safeStorage.decryptString(buffer);
  }

  private async read(): Promise<StoredPayload> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredPayload;
      // Older persisted payloads only carried anthropic+openai slots.
      // Normalise to the full provider keyset so `list()` and `set()` work
      // for newly added providers without needing a migration pass.
      const keys: StoredPayload["keys"] = {};
      for (const provider of AI_PROVIDERS) {
        keys[provider] = parsed.keys?.[provider];
      }
      return { keys };
    } catch {
      const keys: StoredPayload["keys"] = {};
      for (const provider of AI_PROVIDERS) {
        keys[provider] = undefined;
      }
      return { keys };
    }
  }

  private async write(payload: StoredPayload): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  private peekLast(entry: StoredKey): string {
    try {
      const value = safeStorage.decryptString(Buffer.from(entry.encrypted, "base64"));
      return value.slice(-4);
    } catch {
      return "----";
    }
  }
}
