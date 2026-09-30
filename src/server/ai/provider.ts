export interface LlmRequest { system: string; user: string; maxTokens: number }
export interface LlmResult { text: string; inputTokens: number; outputTokens: number }
export interface LlmProvider { name: string; model: string; complete(req: LlmRequest): Promise<LlmResult> }

/** Anthropic Messages API over fetch (no SDK dependency). Temperature 0 for repeatable drafting. */
export function anthropicProvider(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): LlmProvider {
  return {
    name: "anthropic", model,
    async complete({ system, user, maxTokens }) {
      const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: AbortSignal.timeout(90_000),
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: "user", content: user }] }),
      });
      if (!res.ok) throw new Error(`provider status ${res.status}`);
      const j = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      return { text, inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 };
    },
  };
}

/** No key → no provider → drafting is reported unavailable. There is deliberately NO mock/fallback that fabricates a draft. */
export function providerFromEnv(env: Record<string, string | undefined> = process.env): LlmProvider | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key ? anthropicProvider(key, env.AI_MODEL?.trim() || "claude-sonnet-5-5") : null;
}
