import { authFetch } from "./api";

// Ratings are queued here and sent in the background so a study session never
// waits on the network between cards. The outbox lives in localStorage, so a
// rating made on a dead train connection survives a closed tab and goes out the
// next time the app opens.
const STORAGE_KEY = "cram.reviewOutbox";
const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];

let outbox = load();
let flushing = null;
let retryTimer = null;
let retryIndex = 0;
const listeners = new Set();

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(outbox));
  } catch {
    // Storage full or blocked: the in-memory outbox still works for this tab.
  }
  listeners.forEach((fn) => fn(outbox.length));
}

export function pendingReviewCount() {
  return outbox.length;
}

export function subscribeToReviewSync(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function queueReview(deckId, cardId, rating) {
  outbox.push({ deckId, cardId, rating });
  save();
  flushReviews();
}

// Sends queued ratings one at a time, oldest first. Resolves once the outbox is
// empty or a send fails; a failure schedules a retry with a growing delay.
export function flushReviews() {
  if (flushing) return flushing;
  clearTimeout(retryTimer);

  flushing = (async () => {
    while (outbox.length > 0) {
      const { deckId, cardId, rating } = outbox[0];
      try {
        await authFetch(`/api/decks/${deckId}/cards/${cardId}/reviews`, {
          method: "POST",
          body: JSON.stringify({ rating }),
        });
      } catch (e) {
        // A 404 means the card or deck was deleted; retrying will never work.
        if (!/not found/i.test(e.message)) {
          const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
          retryIndex += 1;
          retryTimer = setTimeout(flushReviews, delay);
          return;
        }
      }
      retryIndex = 0;
      outbox = outbox.slice(1);
      save();
    }
  })().finally(() => {
    flushing = null;
  });

  return flushing;
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => flushReviews());
  if (outbox.length > 0) flushReviews();
}
