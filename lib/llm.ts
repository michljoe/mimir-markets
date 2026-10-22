/**
 * Provider-agnostic LLM calls for Mimir agents.
 *
 * Auto-selects between Gemini, Claude, Groq, and OpenRouter based on
 * configured API keys. The active provider can be forced with:
 *   LLM_PROVIDER=gemini|anthropic|groq|openrouter
 *
 * Each provider uses its own default model unless ORACLE_LLM_MODEL is set.
 */

import Anthropic from "@anthropic-ai/sdk";

import { createLLMRouter } from "./llm/router";

export type { LLMProvider } from "./llm/router";

export interface CallLLMOptions {
  /** Max output tokens. Defaults to 1024. */
  maxTokens?: number;
  /** Sampling temperature 0-1. Defaults to 0.2 (deterministic). */
  temperature?: number;
  /** Ask the model for JSON output. Gemini uses responseMimeType; Claude is prompt-hinted. */
  jsonOnly?: boolean;
  /**
   * Gemini responseSchema (https://ai.google.dev/gemini-api/docs/structured-output).
   * responseMimeType alone still lets Gemini "reason in prose" instead of emitting
   * JSON for some prompts; pairing it with a schema makes the grammar constraint
   * strict. Ignored by non-Gemini providers and by Gemma models (see callGeminiModel).
   */
  jsonSchema?: Record<string, unknown>;
  /**
   * Preferred Gemini model for this call (e.g. "gemma-4-26b-it"). Used to spread
   * agent load across models so each gets its own rate-limit bucket. Ignored by
   * non-Gemini providers. Falls back to the rest of the pool if this model is
   * rate-limited. Pick a stable one per agent with `pickGeminiModel(seed)`.
   */
  model?: string;
}

const DEFAULT_GEMINI_MODEL = process.env.ORACLE_LLM_MODEL || "gemini-2.5-flash";

/**
 * Gemini model pool for load-spreading. Free-tier limits are per-model, so
 * assigning different agents to different models multiplies effective throughput.
 * Set GEMINI_MODELS to a comma-separated list of exact model ids (from AI Studio),
 * highest-limit first. Defaults to just the primary model (no spreading).
 */
function geminiModelPool(): string[] {
  const raw = (process.env.GEMINI_MODELS ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const pool = raw.length > 0 ? raw : [DEFAULT_GEMINI_MODEL];
  return pool.filter((m, i) => pool.indexOf(m) === i);
}

/**
 * Extract the first balanced JSON object/array from chatty model output.
 * Gemma (and other non-forced-JSON models) often reason before/after the JSON,
 * which breaks a greedy `\{[\s\S]*\}` match. This scans for the first complete
 * `{...}` or `[...]`, respecting strings/escapes, and ignores surrounding prose.
 * `prefer` forces the opener to look for ("[" for array-returning prompts).
 */
export function extractJson(text: string, prefer?: "{" | "["): string | null {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = prefer
    ? cleaned.indexOf(prefer)
    : cleaned.search(/[{[]/);
  if (start === -1) return null;
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return cleaned.slice(start, i + 1);
  }
  return null;
}

/**
 * Stable model assignment for an agent/persona seed → spreads load deterministically.
 *
 * Gemma is excluded from *assignment*. Every caller of this function asks for
 * strict JSON on a tight output budget, and Gemma reasons in prose first: on the
 * council's 512-token verdicts the array/object never finishes, and on the
 * market-creator's larger batch it does not finish inside the 60s request timeout
 * either. Both failures are silent (an unparsable verdict abstains, an unparsable
 * batch creates no markets), so a hashed Gemma assignment quietly retires whichever
 * agent it lands on. Gemma stays in the pool as a quota-exhaustion fallback —
 * callGemini borrows across the whole pool — it is just never the first choice.
 */
export function pickGeminiModel(seed: string): string {
  const pool = geminiModelPool().filter((m) => !m.toLowerCase().startsWith("gemma"));
  if (pool.length === 0) return DEFAULT_GEMINI_MODEL;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[hash % pool.length];
}
const DEFAULT_ANTHROPIC_MODEL = process.env.ORACLE_LLM_MODEL || "claude-sonnet-4-6";
const DEFAULT_GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";

const GEMINI_QUOTA_COOLDOWN_MS = Number(process.env.LLM_QUOTA_COOLDOWN_MS ?? "300000"); // 5 min
const GROQ_QUOTA_COOLDOWN_MS = Number(process.env.GROQ_QUOTA_COOLDOWN_MS ?? "2700000"); // 45 min
const OPENROUTER_QUOTA_COOLDOWN_MS = Number(process.env.OPENROUTER_QUOTA_COOLDOWN_MS ?? "2700000"); // 45 min

let anthropicClient: Anthropic | null = null;

const llmRouter = createLLMRouter({
  now: () => Date.now(),
  cooldowns: {
    gemini: Number(process.env.LLM_QUOTA_COOLDOWN_MS ?? "300000"),
    groq: Number(process.env.GROQ_QUOTA_COOLDOWN_MS ?? "2700000"),
    openrouter: Number(process.env.OPENROUTER_QUOTA_COOLDOWN_MS ?? "2700000"),
  },
  providers: [
    { id: "gemini", enabled: () => geminiKeyList().length > 0, keys: geminiKeyList, models: geminiModelPool },
    { id: "groq", enabled: () => getGroqKeys().length > 0, keys: getGroqKeys },
    { id: "openrouter", enabled: () => !!process.env.OPENROUTER_API_KEY?.trim() },
    { id: "anthropic", enabled: () => !!process.env.ANTHROPIC_API_KEY?.trim() },
  ],
});

function cooldownRemaining(until: number): number {
  const remaining = until - Date.now();
  return remaining > 0 ? remaining : 0;
}

function keyFingerprint(key: string): string {
  return key.slice(-6);
}

/** Primary Gemini key (possibly per-agent overridden) plus backup keys from GEMINI_API_KEYS. */
function geminiKeyList(): string[] {
  const raw = [
    process.env.GEMINI_API_KEY,
    ...(process.env.GEMINI_API_KEYS ?? "").split(/[,\s]+/),
  ];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const key = value?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function geminiComboCooldown(key: string, model: string): number {
  return llmRouter.providerCooldown("gemini", key, model);
}

/** Gemini is "available" while any (key, model) combination is out of cooldown. */
function geminiCooldownRemaining(): number {
  return llmRouter.providerCooldown("gemini");
}

function openrouterCooldownRemaining(): number {
  return llmRouter.providerCooldown("openrouter");
}

function getGroqKeys(): string[] {
  const raw = [
    process.env.GROQ_API_KEY,
    ...(process.env.GROQ_API_KEYS ?? "").split(/[,\s]+/),
  ];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const key = value?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function groqKeyCooldownRemaining(key: string): number {
  return llmRouter.providerCooldown("groq", key);
}

function groqCooldownRemaining(): number {
  return llmRouter.providerCooldown("groq");
}

function tripGroqCooldown(key: string): void {
  llmRouter.tripCooldown("groq", key);
}

function groqKeyFingerprint(key: string): string {
  return `...${key.slice(-6)}`;
}

function tripGeminiCooldown(key: string, model: string): void {
  llmRouter.tripCooldown("gemini", key, model);
}

function tripOpenRouterCooldown(): void {
  llmRouter.tripCooldown("openrouter");
}

function hasProviderKey(provider: LLMProvider): boolean {
  return llmRouter.fallbackProviders(provider).includes(provider);
}

function providerCooldown(provider: LLMProvider): number {
  if (provider === "gemini") return geminiCooldownRemaining();
  if (provider === "groq") return groqCooldownRemaining();
  if (provider === "openrouter") return openrouterCooldownRemaining();
  return 0;
}

function fallbackProviders(primary: LLMProvider): LLMProvider[] {
  return llmRouter.fallbackProviders(primary);
}

export function activeLLMProvider(): LLMProvider {
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  if (forced === "gemini" || forced === "anthropic" || forced === "groq" || forced === "openrouter") return forced;
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (getGroqKeys().length > 0) return "groq";
  if (process.env.OPENROUTER_API_KEY?.trim()) return "openrouter";
  throw new Error("No LLM API key configured. Set GEMINI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY/GROQ_API_KEYS, or OPENROUTER_API_KEY.");
}

export function activeLLMModel(): string {
  const provider = activeLLMProvider();
  if (provider === "gemini") return DEFAULT_GEMINI_MODEL;
  if (provider === "groq") return DEFAULT_GROQ_MODEL;
  if (provider === "openrouter") return DEFAULT_OPENROUTER_MODEL;
  return DEFAULT_ANTHROPIC_MODEL;
}

/** Redacted fingerprint of the active API key for startup logs. */
export function activeLLMKeyFingerprint(): string {
  const provider = activeLLMProvider();
  const raw = provider === "gemini"
    ? process.env.GEMINI_API_KEY
    : provider === "groq"
    ? getGroqKeys()[0]
    : provider === "openrouter"
    ? process.env.OPENROUTER_API_KEY
    : process.env.ANTHROPIC_API_KEY;
  const key = raw?.trim() ?? "";
  if (!key) return "(missing)";
  return `...${key.slice(-6)} (len=${key.length})`;
}

export async function callLLM(prompt: string, opts: CallLLMOptions = {}): Promise<string> {
  const primary = activeLLMProvider();
  const options = {
    maxTokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.2,
    jsonOnly: opts.jsonOnly ?? false,
    model: opts.model,
    jsonSchema: opts.jsonSchema,
  };
  const candidates = fallbackProviders(primary);
  let lastError: unknown = null;

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const cooldown = providerCooldown(candidate);
    const next = candidates.slice(index + 1).find((provider) => providerCooldown(provider) === 0);

    if (cooldown > 0) {
      lastError = new Error(`${candidate} quota cooldown - ${Math.ceil(cooldown / 1000)}s remaining`);
      if (next) {
        console.warn(`[llm] ${candidate} in cooldown (${Math.ceil(cooldown / 1000)}s) -> ${next} fallback`);
      }
      continue;
    }

    try {
      if (candidate === "gemini") return await callGemini(prompt, options);
      if (candidate === "groq") return await callGroq(prompt, options);
      if (candidate === "openrouter") return await callOpenRouter(prompt, options);
      return await callAnthropic(prompt, options);
    } catch (err) {
      lastError = err;
      if (next) {
        console.warn(`[llm] ${candidate} failed -> ${next} fallback: ${err instanceof Error ? err.message.slice(0, 90) : err}`);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All configured LLM providers failed");
}

async function callGroq(
  prompt: string,
  opts: { maxTokens: number; temperature: number; jsonOnly: boolean },
): Promise<string> {
  const keys = getGroqKeys();
  let lastError: Error | null = null;

  for (const apiKey of keys) {
    const cooldown = groqKeyCooldownRemaining(apiKey);
    if (cooldown > 0) {
      lastError = new Error(`Groq key ${groqKeyFingerprint(apiKey)} in cooldown - ${Math.ceil(cooldown / 1000)}s remaining`);
      continue;
    }

    const body: Record<string, unknown> = {
      model: DEFAULT_GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    };
    if (opts.jsonOnly) body.response_format = { type: "json_object" };

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const bodyText = (await res.text()).slice(0, 500);
      if (res.status === 429) {
        tripGroqCooldown(apiKey);
        lastError = new Error(`Groq ${res.status}: ${bodyText.slice(0, 300)}`);
        console.warn(
          `[llm] Groq key ${groqKeyFingerprint(apiKey)} 429 - trying next key (${Math.round(GROQ_QUOTA_COOLDOWN_MS / 1000)}s cooldown)`,
        );
        continue;
      }
      const lowerBody = bodyText.toLowerCase();
      const badKeyOrRestricted =
        res.status === 401 ||
        res.status === 403 ||
        (res.status === 400 && (
          lowerBody.includes("organization has been restricted") ||
          lowerBody.includes("invalid api key") ||
          lowerBody.includes("invalid_api_key")
        ));
      if (badKeyOrRestricted) {
        tripGroqCooldown(apiKey);
        lastError = new Error(`Groq key ${groqKeyFingerprint(apiKey)} rejected (${res.status}): ${bodyText.slice(0, 180)}`);
        console.warn(`[llm] Groq key ${groqKeyFingerprint(apiKey)} rejected (${res.status}) - trying next key`);
        continue;
      }
      throw new Error(`Groq ${res.status}: ${bodyText.slice(0, 300)}`);
    }

    const json: any = await res.json();
    const text: string = (json?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) throw new Error("Groq empty response");
    return text;
  }

  throw lastError ?? new Error("No Groq API key configured");
}

async function callOpenRouter(
  prompt: string,
  opts: { maxTokens: number; temperature: number; jsonOnly: boolean },
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY!.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME || "Mimir",
  };
  if (process.env.OPENROUTER_SITE_URL?.trim()) {
    headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL.trim();
  }

  const body: Record<string, unknown> = {
    model: DEFAULT_OPENROUTER_MODEL,
    messages: [{ role: "user", content: prompt }],
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
  };
  if (opts.jsonOnly && DEFAULT_OPENROUTER_MODEL !== "openrouter/free") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const bodyText = (await res.text()).slice(0, 500);
    if (res.status === 429) {
      tripOpenRouterCooldown();
      console.warn(`[llm] OpenRouter 429 - entering ${Math.round(OPENROUTER_QUOTA_COOLDOWN_MS / 1000)}s cooldown`);
    }
    throw new Error(`OpenRouter ${res.status}: ${bodyText.slice(0, 300)}`);
  }

  const json: any = await res.json();
  const text: string = (json?.choices?.[0]?.message?.content ?? "").trim();
  if (!text) throw new Error("OpenRouter empty response");
  return text;
}

async function callGemini(
  prompt: string,
  opts: { maxTokens: number; temperature: number; jsonOnly: boolean; model?: string; jsonSchema?: Record<string, unknown> },
): Promise<string> {
  // Try the assigned model first (then borrow other pool models), and for each
  // model try the primary key first (then backup keys). Limits are per key×model,
  // so this exhausts every combination before giving up.
  const pool = geminiModelPool();
  const preferred = opts.model && opts.model.trim().length > 0 ? opts.model.trim() : pool[0];
  const models = [preferred, ...pool.filter((m) => m !== preferred)];
  const keys = geminiKeyList();

  let lastError: unknown = null;
  for (const model of models) {
    for (const key of keys) {
      if (geminiComboCooldown(key, model) > 0) {
        lastError = new Error(`${model}@${keyFingerprint(key)} cooldown`);
        continue;
      }
      try {
        return await callGeminiModel(key, model, prompt, opts);
      } catch (err) {
        lastError = err;
        console.warn(`[llm] Gemini ${model}@${keyFingerprint(key)} failed: ${err instanceof Error ? err.message.slice(0, 80) : err}`);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All Gemini key/model combinations failed");
}

async function callGeminiModel(
  apiKey: string,
  model: string,
  prompt: string,
  opts: { maxTokens: number; temperature: number; jsonOnly: boolean; jsonSchema?: Record<string, unknown> },
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  // Gemma models (gemma-*) share the Gemini API but reject Gemini-only config
  // fields: thinkingConfig and responseMimeType both 400. Drop them for Gemma and
  // ask for JSON in the prompt instead.
  const isGemma = model.toLowerCase().startsWith("gemma");
  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature,
    maxOutputTokens: opts.maxTokens,
  };
  // Some text models expose generateContent and structured output but reject
  // thinkingBudget entirely. Keep them in the quota-spreading pool without
  // sending a capability they do not advertise.
  const rejectsThinkingConfig = new Set(["gemini-3.5-flash-lite", "gemini-3.6-flash"]);
  if (!isGemma && !rejectsThinkingConfig.has(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  let effectivePrompt = prompt;
  if (opts.jsonOnly) {
    if (isGemma) effectivePrompt = `${prompt}\n\nReturn valid JSON only — no markdown, no code fences.`;
    else {
      generationConfig.responseMimeType = "application/json";
      // responseMimeType alone still lets the model "think in prose" before ever
      // emitting JSON — a schema constrains the token grammar itself, which is
      // what actually stops that (seen in prod: verdict calls returning a
      // markdown bullet list instead of JSON despite responseMimeType).
      if (opts.jsonSchema) generationConfig.responseSchema = opts.jsonSchema;
    }
  }

  const transient = new Set([408, 500, 502, 503, 504]);
  const maxAttempts = 4;
  let res: Response | null = null;
  let lastBody = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: effectivePrompt }] }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) break;

    lastBody = (await res.text()).slice(0, 500);
    if (res.status === 429) {
      tripGeminiCooldown(apiKey, model);
      console.warn(`[llm] Gemini ${model}@${keyFingerprint(apiKey)} 429 - ${Math.round(GEMINI_QUOTA_COOLDOWN_MS / 1000)}s cooldown`);
      throw new Error(`Gemini ${model} 429: ${lastBody}`);
    }
    if (!transient.has(res.status) || attempt === maxAttempts) {
      throw new Error(`Gemini ${model} ${res.status}: ${lastBody}`);
    }

    const delayMs = 1000 * 2 ** (attempt - 1);
    console.warn(`[llm] Gemini ${model} ${res.status} (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const json: any = await res!.json();
  const text: string = (json?.candidates?.[0]?.content?.parts ?? [])
    .map((part: any) => part?.text ?? "")
    .join("")
    .trim();
  if (!text) {
    const finishReason = json?.candidates?.[0]?.finishReason ?? "unknown";
    const safety = JSON.stringify(json?.candidates?.[0]?.safetyRatings ?? json?.promptFeedback ?? {});
    throw new Error(`Gemini ${model} empty response (finishReason=${finishReason}, safety=${safety})`);
  }
  return text;
}

async function callAnthropic(
  prompt: string,
  opts: { maxTokens: number; temperature: number; jsonOnly: boolean },
): Promise<string> {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim() });
  }
  const message = await anthropicClient.messages.create({
    model: DEFAULT_ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    messages: [{ role: "user", content: prompt }],
  });
  const block = message.content[0];
  return (block as { text?: string }).text ?? "";
}
