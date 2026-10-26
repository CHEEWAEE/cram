import { supabase } from "./supabase";

export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

// fetch() rejects with a bare TypeError when there's no connection at all.
export class OfflineError extends Error {
  constructor() {
    super("Can't reach Cram. Check your connection and try again.");
    this.name = "OfflineError";
  }
}

export async function authFetch(path, options = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new OfflineError();
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

// Reads go through here so decks and cards still open with no signal: every
// successful GET is saved, and if the network is down the saved copy comes
// back instead, flagged with `offline: true`.
const CACHE_PREFIX = "cram.cache:";

export async function cachedGet(path) {
  try {
    const data = await authFetch(path);
    try {
      localStorage.setItem(CACHE_PREFIX + path, JSON.stringify(data));
    } catch {
      // Storage full or blocked; the live data is still fine to use.
    }
    return { data, offline: false };
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(CACHE_PREFIX + path));
    } catch {
      // fall through to rethrow
    }
    if (saved === null) throw e;
    return { data: saved, offline: true };
  }
}

// Saved copies belong to whoever was logged in, so they go on log out.
export function clearCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(CACHE_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // nothing to clear
  }
}

// Sends a card image straight from the browser to Supabase Storage. The API only
// hands out a one-shot upload token, so the file itself never travels through it.
export async function uploadCardImage(deckId, file) {
  const { path, token, publicUrl } = await authFetch(
    `/api/decks/${deckId}/uploads`,
    { method: "POST", body: JSON.stringify({ contentType: file.type }) }
  );

  const { error } = await supabase.storage
    .from("card-images")
    .uploadToSignedUrl(path, token, file, { contentType: file.type });
  if (error) throw new Error(error.message);

  return publicUrl;
}

// A newly picked image carries a File that has to reach storage before the card
// can reference it; one the user left alone is already a public URL.
export async function resolveImage(deckId, image) {
  if (!image) return null;
  return image.file ? uploadCardImage(deckId, image.file) : image.url;
}

export function imageChanged(image, savedUrl) {
  if (!image) return !!savedUrl;
  return !!image.file || image.url !== savedUrl;
}

// Holds a share token across the login round trip (and the email confirmation,
// which may open in a new tab) when a logged-out visitor asks to save a shared deck.
export const PENDING_SHARE_KEY = "cram.pendingShare";

// The public share preview needs no login, so it skips authFetch.
export async function fetchSharedDeck(token) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/shared/${encodeURIComponent(token)}`);
  } catch {
    throw new OfflineError();
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}
