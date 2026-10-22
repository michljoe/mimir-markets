export type LLMProvider = "gemini" | "anthropic" | "groq" | "openrouter";

export interface RouterProviderConfig {
  id: LLMProvider;
  enabled?: () => boolean;
  keys?: () => string[];
  models?: () => string[];
}

export interface LLMRouteCandidate {
  provider: LLMProvider;
  key?: string;
  model?: string;
}

interface RouterOptions {
  now: () => number;
  cooldowns: Partial<Record<LLMProvider, number>>;
  providers: RouterProviderConfig[];
}

export function createLLMRouter({ now, cooldowns, providers }: RouterOptions) {
  const groqCooldownByKey = new Map<string, number>();
  const geminiCooldownByCombo = new Map<string, number>();
  let openrouterCooldownUntil = 0;

  function cooldownRemaining(until: number): number {
    const remaining = until - now();
    return remaining > 0 ? remaining : 0;
  }

  function keyFingerprint(key: string): string {
    return `...${key.slice(-6)}`;
  }

  function providerConfig(provider: LLMProvider): RouterProviderConfig | undefined {
    return providers.find((entry) => entry.id === provider);
  }

  function hasProviderKey(provider: LLMProvider): boolean {
    const config = providerConfig(provider);
    if (!config) return false;
    if (config.enabled) return config.enabled();
    if (provider === "groq") return (config.keys?.() ?? []).length > 0;
    if (provider === "gemini") return (config.keys?.() ?? []).length > 0 && (config.models?.() ?? []).length > 0;
    if (provider === "openrouter") return true;
    return true;
  }

  function providerCooldown(provider: LLMProvider, key?: string, model?: string): number {
    if (provider === "openrouter") {
      return cooldownRemaining(openrouterCooldownUntil);
    }

    if (provider === "groq") {
      if (key) return cooldownRemaining(groqCooldownByKey.get(key) ?? 0);
      const keys = providerConfig("groq")?.keys?.() ?? [];
      if (keys.length === 0) return 0;
      const cooldowns = keys.map((entry) => cooldownRemaining(groqCooldownByKey.get(entry) ?? 0));
      if (cooldowns.some((value) => value === 0)) return 0;
      return Math.min(...cooldowns);
    }

    if (provider === "gemini") {
      if (key && model) {
        return cooldownRemaining(geminiCooldownByCombo.get(`${keyFingerprint(key)}|${model}`) ?? 0);
      }
      const keys = providerConfig("gemini")?.keys?.() ?? [];
      const models = providerConfig("gemini")?.models?.() ?? [];
      if (keys.length === 0 || models.length === 0) return 0;
      const cooldowns = keys.flatMap((entry) =>
        models.map((entryModel) => cooldownRemaining(geminiCooldownByCombo.get(`${keyFingerprint(entry)}|${entryModel}`) ?? 0)),
      );
      if (cooldowns.some((value) => value === 0)) return 0;
      return Math.min(...cooldowns);
    }

    return 0;
  }

  function fallbackProviders(primary: LLMProvider): LLMProvider[] {
    const preferred: LLMProvider[] = primary === "openrouter"
      ? [primary, "groq", "anthropic", "gemini"]
      : [primary, "groq", "anthropic", "gemini", "openrouter"];

    return preferred.filter((provider, index) => {
      if (preferred.indexOf(provider) !== index) return false;
      if (!hasProviderKey(provider)) return false;
      if (provider === "anthropic") return true;
      return providerCooldown(provider) === 0;
    });
  }

  function chooseNext(primary: LLMProvider): LLMRouteCandidate | null {
    for (const provider of fallbackProviders(primary)) {
      if (provider === "anthropic") {
        return { provider };
      }

      if (provider === "openrouter") {
        if (providerCooldown("openrouter") === 0) {
          return { provider };
        }
        continue;
      }

      if (provider === "groq") {
        const keys = providerConfig("groq")?.keys?.() ?? [];
        const readyKey = keys.find((key) => providerCooldown("groq", key) === 0);
        if (readyKey) return { provider: "groq", key: readyKey };
        continue;
      }

      if (provider === "gemini") {
        const keys = providerConfig("gemini")?.keys?.() ?? [];
        const models = providerConfig("gemini")?.models?.() ?? [];
        const ready = keys
          .flatMap((key) => models.map((model) => ({ key, model })))
          .find(({ key, model }) => providerCooldown("gemini", key, model) === 0);
        if (ready) {
          return { provider: "gemini", key: ready.key, model: ready.model };
        }
      }
    }

    return null;
  }

  function allCooledDownMessage(primary: LLMProvider): string {
    const order = fallbackProviders(primary).join(", ") || "none";
    return `All configured LLM providers are in cooldown (primary=${primary}, order=${order}).`;
  }

  function tripCooldown(provider: LLMProvider, key?: string, model?: string): void {
    if (provider === "openrouter") {
      openrouterCooldownUntil = now() + (cooldowns.openrouter ?? 0);
      return;
    }

    if (provider === "groq") {
      if (!key) return;
      groqCooldownByKey.set(key, now() + (cooldowns.groq ?? 0));
      return;
    }

    if (provider === "gemini") {
      if (!key || !model) return;
      geminiCooldownByCombo.set(`${keyFingerprint(key)}|${model}`, now() + (cooldowns.gemini ?? 0));
    }
  }

  return {
    fallbackProviders,
    chooseNext,
    allCooledDownMessage,
    tripCooldown,
    providerCooldown,
  };
}
