const STORAGE_KEY = "proven.privateInviteKeys";

type PrivateInviteMap = Record<string, string>;

function readInviteMap(): PrivateInviteMap {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as PrivateInviteMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("Failed to read stored private invite keys", error);
    return {};
  }
}

function writeInviteMap(value: PrivateInviteMap) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (error) {
    console.warn("Failed to persist private invite key", error);
  }
}

export function rememberPrivateInviteKey(vsId: number, inviteKey: string) {
  if (!inviteKey) {
    return;
  }

  const current = readInviteMap();
  current[String(vsId)] = inviteKey;
  writeInviteMap(current);
}

export function getStoredPrivateInviteKey(vsId: number) {
  const current = readInviteMap();
  return current[String(vsId)] ?? "";
}

export function generatePrivateInviteKey() {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error(
      "Secure random generation is unavailable; cannot create a private invite key.",
    );
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
