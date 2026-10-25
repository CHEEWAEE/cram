import { supabase } from "./supabase";

export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

export async function authFetch(path, options = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
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

// Holds a share token across the login round trip (and the email confirmation, which may open in a new tab) when a logged-out visitor
// asks to save a shared deck.
export const PENDING_SHARE_KEY = "cram.pendingShare";

// The public share preview needs no login, so it skips authFetch.
export async function fetchSharedDeck(token) {
  const res = await fetch(`${API_BASE}/api/shared/${encodeURIComponent(token)}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}
