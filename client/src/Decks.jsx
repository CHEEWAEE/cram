import { useEffect, useState } from "react";
import { authFetch, PENDING_SHARE_KEY } from "./api";
import DeckDetail from "./DeckDetail";
import StrengthBar from "./StrengthBar";

function Decks() {
  const [decks, setDecks] = useState([]);
  const [selectedDeck, setSelectedDeck] = useState(null);
  const [newDeckTitle, setNewDeckTitle] = useState("");
  const [newDeckDescription, setNewDeckDescription] = useState("");
  const [editingDeckId, setEditingDeckId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    // Someone who opened a share link while logged out lands here after
    // logging in; finish saving the deck they asked for.
    const pending = localStorage.getItem(PENDING_SHARE_KEY);
    if (pending) {
      localStorage.removeItem(PENDING_SHARE_KEY);
      authFetch(`/api/shared/${pending}/copy`, { method: "POST" })
        .then((deck) => setNotice(`Saved "${deck.title}" to your decks.`))
        .catch((e) => setError(e.message))
        .finally(loadDecks);
    } else {
      loadDecks();
    }
  }, []);

  async function loadDecks() {
    try {
      setDecks(await authFetch("/api/decks"));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleCreateDeck() {
    if (!newDeckTitle.trim()) return setError("Deck title is required.");
    try {
      await authFetch("/api/decks", {
        method: "POST",
        body: JSON.stringify({
          title: newDeckTitle,
          description: newDeckDescription,
        }),
      });
      setNewDeckTitle("");
      setNewDeckDescription("");
      setError("");
      await loadDecks();
    } catch (e) {
      setError(e.message);
    }
  }

  function startEditDeck(deck) {
    setEditingDeckId(deck.id);
    setEditTitle(deck.title);
    setEditDescription(deck.description || "");
  }

  async function handleSaveDeck(deckId) {
    if (!editTitle.trim()) return setError("Deck title is required.");
    try {
      await authFetch(`/api/decks/${deckId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: editTitle, description: editDescription }),
      });
      setEditingDeckId(null);
      setError("");
      await loadDecks();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDeleteDeck(deck) {
    if (!window.confirm(`Delete "${deck.title}" and all its cards? This can't be undone.`)) {
      return;
    }
    try {
      await authFetch(`/api/decks/${deck.id}`, { method: "DELETE" });
      setError("");
      await loadDecks();
    } catch (e) {
      setError(e.message);
    }
  }

  if (selectedDeck) {
    return (
      <DeckDetail
        deck={selectedDeck}
        onBack={() => {
          setSelectedDeck(null);
          loadDecks();
        }}
      />
    );
  }

  return (
    <div className="decks-page">
      <h2>Your decks</h2>
      {notice && <p className="notice">{notice}</p>}

      <div className="deck-list">
        {decks.map((deck) =>
          editingDeckId === deck.id ? (
            <div className="deck-row-editing" key={deck.id}>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Title"
              />
              <input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Description (optional)"
              />
              <div className="row-actions">
                <button
                  className="auth-button auth-button-primary"
                  onClick={() => handleSaveDeck(deck.id)}
                >
                  Save
                </button>
                <button
                  className="auth-button auth-button-secondary"
                  onClick={() => setEditingDeckId(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="deck-row" key={deck.id}>
              <button
                className="deck-row-main"
                onClick={() => setSelectedDeck(deck)}
              >
                <span className="deck-title">{deck.title}</span>
                {deck.description && (
                  <span className="deck-description">{deck.description}</span>
                )}
                <span className="deck-meta">
                  {deck.card_count ?? 0} card{deck.card_count === 1 ? "" : "s"}
                  {deck.card_count > 0 && <StrengthBar value={deck.avg_strength} />}
                </span>
              </button>
              <div className="row-actions">
                <button className="icon-button" onClick={() => startEditDeck(deck)}>
                  Edit
                </button>
                <button
                  className="icon-button icon-button-danger"
                  onClick={() => handleDeleteDeck(deck)}
                >
                  Delete
                </button>
              </div>
            </div>
          )
        )}
        {decks.length === 0 && (
          <p className="deck-empty">No decks yet — create your first one below.</p>
        )}
      </div>

      <div className="create-deck-form">
        <label className="auth-field">
          Title
          <input
            value={newDeckTitle}
            onChange={(e) => setNewDeckTitle(e.target.value)}
            placeholder="e.g. Cardiovascular Pharm"
          />
        </label>
        <label className="auth-field">
          Description
          <input
            value={newDeckDescription}
            onChange={(e) => setNewDeckDescription(e.target.value)}
            placeholder="optional"
          />
        </label>
        <button
          className="auth-button auth-button-primary"
          onClick={handleCreateDeck}
        >
          Create deck
        </button>
      </div>

      {error && <p className="auth-message">{error}</p>}
    </div>
  );
}

export default Decks;
