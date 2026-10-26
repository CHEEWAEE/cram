// Turns a pasted list into cards: one card per line, front and back split by
// the first separator found. Quizlet and Anki exports use a tab; people
// typing a list by hand tend to use " - ", a colon or a comma.
//
// The separator is chosen once for the whole paste (the first candidate that
// appears on most lines), so a comma inside an answer doesn't split a list
// that was really separated by dashes.
const SEPARATORS = ["\t", " - ", " – ", " — ", " = ", ": ", ";", ","];

export function parseCardList(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { cards: [], skipped: [], separator: null };

  const separator =
    SEPARATORS.find((sep) => lines.filter((l) => l.includes(sep)).length > lines.length / 2) ||
    SEPARATORS.find((sep) => lines.some((l) => l.includes(sep))) ||
    null;

  const cards = [];
  const skipped = [];
  for (const line of lines) {
    const at = separator ? line.indexOf(separator) : -1;
    const front = at === -1 ? "" : line.slice(0, at).trim();
    const back = at === -1 ? "" : line.slice(at + separator.length).trim();
    if (front && back) cards.push({ frontText: front, backText: back });
    else skipped.push(line);
  }
  return { cards, skipped, separator };
}
