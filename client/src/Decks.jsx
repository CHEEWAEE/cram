import { useEffect, useState } from "react";
import { supabase } from "./supabase";

const API_BASE = "http://localhost:3001";

async function authFetch(path, options = {}) {
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
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

function Decks() {
  const [decks, setDecks] = useState([]);
  const [selectedDeck, setSelectedDeck] = useState(null);
  const [cards, setCards] = useState([]);
  const [newDeckTitle, setNewDeckTitle] = useState("");
  const [newDeckDescription, setNewDeckDescription] = useState("");
  const [newCardFront, setNewCardFront] = useState("");
  const [newCardBack, setNewCardBack] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadDecks();
  }, []);

  async function loadDecks() {
    try {
      setDecks(await authFetch("/api/decks"));
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadCards(deckId) {
    try {
      setCards(await authFetch(`/api/decks/${deckId}/cards`));
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

  async function openDeck(deck) {
    setSelectedDeck(deck);
    setError("");
    await loadCards(deck.id);
  }

  async function handleCreateCard() {
    if (!newCardFront.trim() || !newCardBack.trim()) {
      return setError("Both sides of the card are required.");
    }
    try {
      await authFetch(`/api/decks/${selectedDeck.id}/cards`, {
        method: "POST",
        body: JSON.stringify({
          frontText: newCardFront,
          backText: newCardBack,
        }),
      });
      setNewCardFront("");
      setNewCardBack("");
      setError("");
      await loadCards(selectedDeck.id);
    } catch (e) {
      setError(e.message);
    }
  }

  if (selectedDeck) {
    return (
      <div className="decks-page">
        <div className="decks-header">
          <button className="auth-link" onClick={() => setSelectedDeck(null)}>
            ← Decks
          </button>
          <h2>{selectedDeck.title}</h2>
        </div>

        <div className="card-list">
          {cards.map((card) => (
            <div className="card-row" key={card.id}>
              <span className="card-front">{card.front_text}</span>
              <span className="card-back">{card.back_text}</span>
            </div>
          ))}
          {cards.length === 0 && (
            <p className="deck-empty">No cards yet — add the first one below.</p>
          )}
        </div>

        <div className="create-card-form">
          <label className="auth-field">
            Front
            <input
              value={newCardFront}
              onChange={(e) => setNewCardFront(e.target.value)}
              placeholder="Question"
            />
          </label>
          <label className="auth-field">
            Back
            <input
              value={newCardBack}
              onChange={(e) => setNewCardBack(e.target.value)}
              placeholder="Answer"
            />
          </label>
          <button
            className="auth-button auth-button-primary"
            onClick={handleCreateCard}
          >
            Add card
          </button>
        </div>

        {error && <p className="auth-message">{error}</p>}
      </div>
    );
  }

  return (
    <div className="decks-page">
      <h2>Your decks</h2>

      <div className="deck-list">
        {decks.map((deck) => (
          <button
            className="deck-row"
            key={deck.id}
            onClick={() => openDeck(deck)}
          >
            <span className="deck-title">{deck.title}</span>
            {deck.description && (
              <span className="deck-description">{deck.description}</span>
            )}
          </button>
        ))}
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
