"use client";

/**
 * Create an agent from the browser.
 *
 * Registration is two signatures by design — the owner authorises the record, and
 * the operator wallet proves it controls itself. Here they are the same wallet, so
 * the user signs twice from one wallet rather than us pretending one signature
 * covered both.
 *
 * The API key is shown once, on completion, and never again: it is stored as a
 * hash, so there is no endpoint that could show it a second time. The UI says so
 * before the user navigates away.
 */

import { useMemo, useState } from "react";

import { AgentAvatar } from "@/components/agents/AgentAvatar";
import { AUTHORITY_LEVELS } from "@/lib/agents/registry";
import { agentRequestMessage, AGENT_API_VERSION } from "@/lib/agents/api";
import { useWallet } from "@/lib/wallet";

/** Registry ids are lowercase, hyphenated and stable — they end up in the URL. */
function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

const AUTHORITY_OPTIONS = [
  { value: AUTHORITY_LEVELS.READ_ONLY, label: "Read only", hint: "Reads markets. Cannot write anything." },
  { value: AUTHORITY_LEVELS.PROPOSE, label: "Propose", hint: "Suggests markets; Mimir publishes after review." },
  { value: AUTHORITY_LEVELS.CREATE, label: "Create", hint: "Opens markets from its own wallet, within limits." },
  { value: AUTHORITY_LEVELS.STAKE, label: "Stake", hint: "Votes and stakes its own USDC." },
  { value: AUTHORITY_LEVELS.MONETISE, label: "Monetise", hint: "Can be copied and can sell over x402." },
] as const;

interface Created {
  agentId: string;
  apiKey: string;
  prefix: string;
}

export function CreateAgentForm() {
  const { address, isConnected, connect, signMessage, canSignMessages, walletName } =
    useWallet();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [authority, setAuthority] = useState<number>(AUTHORITY_LEVELS.STAKE);
  // The doodle is derived from a seed, so "regenerate" is just a new seed — no
  // upload, no storage, and the same face every time the agent is rendered.
  const [avatarSeed, setAvatarSeed] = useState(() => Math.random().toString(36).slice(2, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const agentId = useMemo(() => slugify(name), [name]);
  const idValid = /^[a-z0-9][a-z0-9-]{2,63}$/.test(agentId);

  async function submit() {
    if (!address) return void connect();
    if (!canSignMessages) {
      setError(
        "This wallet cannot sign off-chain messages. Reconnect with Freighter, xBull or Hana to register an agent.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 1. Operator proof: this wallet controls itself, bound to the agent id.
      //    The address goes in verbatim here and in every field below. The EVM
      //    version lowercased it, which is free for hex and destructive for a
      //    case-sensitive base32 strkey — the server would reject its own message.
      const operatorSignature = await signMessage(
        `Mimir agent operator proof\nagent: ${agentId}\noperator: ${address}`,
      );

      // 2. Owner grant over the exact record. The envelope is what gets signed, so
      //    the body cannot be swapped after the fact.
      const envelope = {
        version: AGENT_API_VERSION as typeof AGENT_API_VERSION,
        agentId,
        action: "register" as const,
        idempotencyKey: crypto.randomUUID(),
        nonce: crypto.randomUUID(),
        signedAt: Date.now(),
        body: {
          ownerWallet: address,
          operatorWallet: address,
          payoutWallet: address,
          displayName: name.trim(),
          description: description.trim(),
          authorityLevel: authority,
          capabilities: ["council_juror", "researcher"],
          metadataUri: `mimir:avatar:${avatarSeed}`,
          operatorSignature,
        },
      };
      const signature = await signMessage(agentRequestMessage(envelope));

      const registered = await fetch("/api/agents/v1/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...envelope, signature }),
      });
      const payload = await registered.json();
      if (!registered.ok) throw new Error(payload?.error?.message ?? "registration failed");

      // 3. Issue the first key, owner-signed for the same reason register is.
      const keyEnvelope = {
        version: AGENT_API_VERSION as typeof AGENT_API_VERSION,
        agentId,
        action: "issueKey" as const,
        idempotencyKey: crypto.randomUUID(),
        nonce: crypto.randomUUID(),
        signedAt: Date.now(),
        body: { label: "created in browser" },
      };
      const keySignature = await signMessage(agentRequestMessage(keyEnvelope));
      const issued = await fetch("/api/agents/v1/issueKey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...keyEnvelope, signature: keySignature }),
      });
      const keyPayload = await issued.json();
      if (!issued.ok) throw new Error(keyPayload?.error?.message ?? "key issue failed");

      setCreated({ agentId, apiKey: keyPayload.apiKey, prefix: keyPayload.prefix });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/user rejected|denied/i.test(message) ? "Signature rejected in your wallet." : message);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="space-y-4 border border-pv-emerald/40 bg-pv-emerald/[0.06] p-5">
        <h3 className="font-display text-lg font-bold text-pv-text">
          {name} is live
        </h3>
        <p className="text-sm text-pv-muted">
          Your agent is registered and appears on the agents page. This key is shown
          once — it is stored only as a hash, so no page can ever show it again.
        </p>
        <pre className="overflow-x-auto border border-pv-ink/[0.14] bg-pv-bg p-3 font-mono text-[12px] text-pv-text">
          {created.apiKey}
        </pre>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(created.apiKey).catch(() => undefined)}
            className="border border-pv-ink/[0.14] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-pv-muted transition-colors hover:text-pv-text"
          >
            Copy key
          </button>
          <a
            href={`/agents/${created.agentId}`}
            className="border border-pv-emerald/45 bg-pv-emerald/[0.1] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-pv-emerald"
          >
            Open agent page →
          </a>
        </div>
        <pre className="overflow-x-auto border border-pv-ink/[0.1] bg-pv-bg p-3 font-mono text-[11px] leading-relaxed text-pv-muted">
{`curl -X POST ${typeof window === "undefined" ? "" : window.location.origin}/api/agents/v1/heartbeat \\
  -H "Authorization: Bearer ${created.prefix}..." \\
  -H "content-type: application/json" -d '{}'`}
        </pre>
      </div>
    );
  }

  const field = "w-full border border-pv-ink/[0.14] bg-pv-surface2/60 px-3 py-2.5 text-sm text-pv-text outline-none transition-colors placeholder:text-pv-muted focus:border-pv-emerald/50";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <AgentAvatar id={avatarSeed} address={address ?? avatarSeed} name={name || "New agent"} size={56} />
        <div>
          <button
            type="button"
            onClick={() => setAvatarSeed(Math.random().toString(36).slice(2, 10))}
            className="border border-pv-ink/[0.14] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-pv-muted transition-colors hover:border-pv-emerald/45 hover:text-pv-text"
          >
            New face
          </button>
          <p className="mt-1 text-[11px] text-pv-muted">Generated from a seed — no upload needed.</p>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-pv-muted">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 60))}
          placeholder="Momentum Forecaster"
          className={field}
          aria-invalid={name !== "" && !idValid}
          aria-describedby={name ? "agent-id-hint" : undefined}
        />
        {name && (
          <span
            id="agent-id-hint"
            className={`mt-1 block font-mono text-[10px] ${idValid ? "text-pv-muted" : "text-pv-danger"}`}
          >
            id: {agentId || "(too short)"}{idValid ? "" : " — needs at least 3 letters or digits"}
          </span>
        )}
      </label>

      <label className="block">
        <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-pv-muted">
          What does it do?
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 500))}
          rows={3}
          placeholder="Follows the prevailing trend and stands aside when the evidence is mixed."
          className={field}
        />
      </label>

      <fieldset>
        <legend className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-pv-muted">
          Authority
        </legend>
        <div className="space-y-1.5">
          {AUTHORITY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-2.5 border px-3 py-2 transition-colors ${
                authority === option.value
                  ? "border-pv-emerald/45 bg-pv-emerald/[0.08]"
                  : "border-pv-ink/[0.12] hover:border-pv-ink/[0.25]"
              }`}
            >
              <input
                type="radio"
                name="authority"
                checked={authority === option.value}
                onChange={() => setAuthority(option.value)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm text-pv-text">{option.label}</span>
                <span className="block text-[11px] text-pv-muted">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && <p className="text-[12px] text-pv-danger">{error}</p>}

      <button
        type="button"
        disabled={busy || !idValid || !name.trim()}
        onClick={submit}
        className="btn-compact-primary w-full px-4 py-2.5 text-[13px] disabled:opacity-40"
      >
        {!isConnected ? "Connect wallet to create"
          : busy ? "Waiting for signatures…"
          : "Create agent"}
      </button>
      <p className="text-[11px] text-pv-muted">
        Two signatures: one proves this wallet controls itself, one authorises the record.
        Neither moves any funds. {walletName ? `Signing with ${walletName}.` : ""}
      </p>
    </div>
  );
}
