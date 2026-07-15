import { useEffect, useState } from "react";
import { authFetch } from "./api";
import ImageDropZone from "./ImageDropZone";
import StudySession from "./StudySession";

function DeckDetail({ deck, onBack }) {
  const [cards, setCards] = useState([]);
  const [newCardFront, setNewCardFront] = useState("");
  const [newCardBack, setNewCardBack] = useState("");
  const [newCardFrontImage, setNewCardFrontImage] = useState(null);
  const [newCardBackImage, setNewCardBackImage] = useState(null);
  const [editingCardId, setEditingCardId] = useState(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [editFrontImage, setEditFrontImage] = useState(null);
  const [editBackImage, setEditBackImage] = useState(null);
  const [studying, setStudying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.id]);

  async function loadCards() {
    try {
      setCards(await authFetch(`/api/decks/${deck.id}/cards`));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleCreateCard() {
    const hasFront = newCardFront.trim() || newCardFrontImage;
    const hasBack = newCardBack.trim() || newCardBackImage;
    if (!hasFront || !hasBack) {
      return setError("Each side needs text, an image, or both.");
    }
    try {
      await authFetch(`/api/decks/${deck.id}/cards`, {
        method: "POST",
        body: JSON.stringify({
          frontText: newCardFront,
          backText: newCardBack,
          frontImage: newCardFrontImage,
          backImage: newCardBackImage,
        }),
      });
      setNewCardFront("");
      setNewCardBack("");
      setNewCardFrontImage(null);
      setNewCardBackImage(null);
      setError("");
      await loadCards();
    } catch (e) {
      setError(e.message);
    }
  }

  function startEditCard(card) {
    setEditingCardId(card.id);
    setEditFront(card.front_text || "");
    setEditBack(card.back_text || "");
    setEditFrontImage(card.front_image_url || null);
    setEditBackImage(card.back_image_url || null);
  }

  async function handleSaveCard(card) {
    const body = { frontText: editFront, backText: editBack };
    if (editFrontImage !== (card.front_image_url || null)) {
      body.frontImage = editFrontImage;
    }
    if (editBackImage !== (card.back_image_url || null)) {
      body.backImage = editBackImage;
    }

    try {
      await authFetch(`/api/decks/${deck.id}/cards/${card.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setEditingCardId(null);
      setError("");
      await loadCards();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDeleteCard(card) {
    if (!window.confirm("Delete this card?")) return;
    try {
      await authFetch(`/api/decks/${deck.id}/cards/${card.id}`, {
        method: "DELETE",
      });
      setError("");
      await loadCards();
    } catch (e) {
      setError(e.message);
    }
  }

  if (studying) {
    return (
      <StudySession
        deck={deck}
        cards={cards}
        onExit={() => {
          setStudying(false);
          loadCards();
        }}
      />
    );
  }

  return (
    <div className="decks-page">
      <div className="decks-header">
        <div className="decks-header-left">
          <button className="auth-link" onClick={onBack}>
            ← Decks
          </button>
          <h2>{deck.title}</h2>
        </div>
        {cards.length > 0 && (
          <button
            className="auth-button auth-button-primary start-study-button"
            onClick={() => setStudying(true)}
          >
            Study
          </button>
        )}
      </div>

      <div className="card-list">
        {cards.map((card) =>
          editingCardId === card.id ? (
            <div className="card-row-editing" key={card.id}>
              <label className="auth-field">
                Front
                <input
                  value={editFront}
                  onChange={(e) => setEditFront(e.target.value)}
                />
              </label>
              <label className="auth-field">
                Back
                <input
                  value={editBack}
                  onChange={(e) => setEditBack(e.target.value)}
                />
              </label>
              <div className="card-images">
                <ImageDropZone
                  label="Front image"
                  value={editFrontImage}
                  onChange={setEditFrontImage}
                />
                <ImageDropZone
                  label="Back image"
                  value={editBackImage}
                  onChange={setEditBackImage}
                />
              </div>
              <div className="row-actions">
                <button
                  className="auth-button auth-button-primary"
                  onClick={() => handleSaveCard(card)}
                >
                  Save
                </button>
                <button
                  className="auth-button auth-button-secondary"
                  onClick={() => setEditingCardId(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="card-row" key={card.id}>
              {card.front_image_url && (
                <img className="card-thumb" src={card.front_image_url} alt="" />
              )}
              <span className="card-front">{card.front_text}</span>
              {card.back_image_url && (
                <img className="card-thumb" src={card.back_image_url} alt="" />
              )}
              <span className="card-back">{card.back_text}</span>
              <div className="row-actions">
                <button className="icon-button" onClick={() => startEditCard(card)}>
                  Edit
                </button>
                <button
                  className="icon-button icon-button-danger"
                  onClick={() => handleDeleteCard(card)}
                >
                  Delete
                </button>
              </div>
            </div>
          )
        )}
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
        <div className="card-images">
          <ImageDropZone
            label="Drop, paste, or click to add a front image"
            value={newCardFrontImage}
            onChange={setNewCardFrontImage}
          />
          <ImageDropZone
            label="Drop, paste, or click to add a back image"
            value={newCardBackImage}
            onChange={setNewCardBackImage}
          />
        </div>
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

export default DeckDetail;
