export function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Reverse mode studies back → front. The card keeps its id, so ratings still
// land on the right card; `reversed` lets an edit swap it back before saving.
export function swapSides(card) {
  return {
    ...card,
    front_text: card.back_text,
    back_text: card.front_text,
    front_image_url: card.back_image_url,
    back_image_url: card.front_image_url,
    reversed: !card.reversed,
  };
}

export const QUICK_SESSION_SIZE = 10;
// Weak cards mode: the weakest cards below this strength, capped so a session
// stays short enough to finish.
const WEAK_THRESHOLD = 0.6;
const WEAK_SESSION_MAX = 20;

export function weakCards(cards) {
  return cards
    .filter((c) => (c.strength ?? 0) < WEAK_THRESHOLD)
    .sort((a, b) => (a.strength ?? 0) - (b.strength ?? 0))
    .slice(0, WEAK_SESSION_MAX);
}

export function quickCards(cards) {
  return shuffle(cards).slice(0, QUICK_SESSION_SIZE);
}
