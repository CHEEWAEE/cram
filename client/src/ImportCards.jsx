import { useState } from "react";
import { authFetch } from "./api";
import { parseCardList } from "./parseCardList";

const SEPARATOR_NAMES = {
  "\t": "tabs",
  " - ": "dashes",
  " – ": "dashes",
  " — ": "dashes",
  " = ": "equals signs",
  ": ": "colons",
  ";": "semicolons",
  ",": "commas",
};

// Matches the API's limit on one import.
const MAX_IMPORT = 1000;

// Paste a list, see what it turns into, add the lot in one request.
function ImportCards({ deckId, onImported, onCancel }) {
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const { cards, skipped, separator } = parseCardList(text);
  const tooMany = cards.length > MAX_IMPORT;

  async function handleImport() {
    setImporting(true);
    try {
      const { imported } = await authFetch(`/api/decks/${deckId}/cards/bulk`, {
        method: "POST",
        body: JSON.stringify({ cards }),
      });
      onImported(imported);
    } catch (e) {
      setError(e.message);
      setImporting(false);
    }
  }

  return (
    <div className="import-panel">
      <div className="import-head">
        <span className="side-field-label">Import cards</span>
        <button className="auth-link" onClick={onCancel}>
          Close
        </button>
      </div>
      <p className="deck-empty import-help">
        One card per line, front and back split by a tab, dash, colon or comma.
        Quizlet and Anki exports paste straight in.
      </p>
      <textarea
        className="import-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"mitochondria - powerhouse of the cell\nosmosis - water moving across a membrane"}
        rows={8}
        aria-label="Cards to import"
      />

      {cards.length > 0 && (
        <div className="import-preview">
          <div className="deck-meta">
            {cards.length} card{cards.length === 1 ? "" : "s"}, split on {SEPARATOR_NAMES[separator]}
            {skipped.length > 0 && ` · ${skipped.length} line${skipped.length === 1 ? "" : "s"} skipped`}
          </div>
          {cards.slice(0, 3).map((c, i) => (
            <div className="import-row" key={i}>
              <span className="card-front">{c.frontText}</span>
              <span className="card-back">{c.backText}</span>
            </div>
          ))}
          {skipped.length > 0 && (
            <p className="deck-empty">
              Skipped (no front and back found): {skipped.slice(0, 3).join(" · ")}
              {skipped.length > 3 && " …"}
            </p>
          )}
        </div>
      )}

      <button
        className="auth-button auth-button-primary"
        disabled={cards.length === 0 || tooMany || importing}
        onClick={handleImport}
      >
        {importing
          ? "Importing…"
          : cards.length === 0
            ? "Import cards"
            : `Import ${cards.length} card${cards.length === 1 ? "" : "s"}`}
      </button>
      {tooMany && (
        <p className="auth-message">
          That's {cards.length} cards. Import at most {MAX_IMPORT} at a time.
        </p>
      )}
      {error && <p className="auth-message">{error}</p>}
    </div>
  );
}

export default ImportCards;
