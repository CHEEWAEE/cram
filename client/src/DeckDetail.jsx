import { useEffect, useState } from "react";
import { authFetch, uploadCardImage } from "./api";
import ImageDropZone from "./ImageDropZone";
import StudySession from "./StudySession";
import StrengthBar from "./StrengthBar";
import { flushReviews } from "./reviewSync";

const QUICK_SESSION_SIZE = 10;
// Weak cards mode: the weakest cards below this strength, capped so a session
// stays short enough to finish.
const WEAK_THRESHOLD = 0.6;
const WEAK_SESSION_MAX = 20;

function weakCards(cards) {
  return cards
    .filter((c) => (c.strength ?? 0) < WEAK_THRESHOLD)
    .sort((a, b) => (a.strength ?? 0) - (b.strength ?? 0))
    .slice(0, WEAK_SESSION_MAX);
}

function quickCards(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, QUICK_SESSION_SIZE);
}

// A newly picked image carries a File that has to reach storage before the card
// can reference it; one the user left alone is already a public URL.
async function resolveImage(deckId, image) {
  if (!image) return null;
  return image.file ? uploadCardImage(deckId, image.file) : image.url;
}

function imageChanged(image, savedUrl) {
  if (!image) return !!savedUrl;
  return !!image.file || image.url !== savedUrl;
}

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
  const [session, setSession] = useState(null); // { cards, title } while studying
  const [shareToken, setShareToken] = useState(deck.share_token || null);
  const [notice, setNotice] = useState("");
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
      const [frontImageUrl, backImageUrl] = await Promise.all([
        resolveImage(deck.id, newCardFrontImage),
        resolveImage(deck.id, newCardBackImage),
      ]);
      await authFetch(`/api/decks/${deck.id}/cards`, {
        method: "POST",
        body: JSON.stringify({
          frontText: newCardFront,
          backText: newCardBack,
          frontImageUrl,
          backImageUrl,
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
    setEditFrontImage(
      card.front_image_url ? { url: card.front_image_url } : null
    );
    setEditBackImage(card.back_image_url ? { url: card.back_image_url } : null);
  }

  async function handleSaveCard(card) {
    const body = { frontText: editFront, backText: editBack };

    try {
      if (imageChanged(editFrontImage, card.front_image_url)) {
        body.frontImageUrl = await resolveImage(deck.id, editFrontImage);
      }
      if (imageChanged(editBackImage, card.back_image_url)) {
        body.backImageUrl = await resolveImage(deck.id, editBackImage);
      }

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

  async function shareLink(token) {
    const url = `${window.location.origin}/s/${token}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: deck.title, url });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Link copied. Anyone with it can save their own copy.");
    } catch {
      setNotice(url);
    }
  }

  async function handleShare() {
    try {
      const { shareToken: token } = await authFetch(`/api/decks/${deck.id}/share`, {
        method: "POST",
      });
      setShareToken(token);
      setError("");
      await shareLink(token);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleStopSharing() {
    if (!window.confirm("Turn off the share link? Copies people already saved stay theirs.")) {
      return;
    }
    try {
      await authFetch(`/api/decks/${deck.id}/share`, { method: "DELETE" });
      setShareToken(null);
      setNotice("Share link turned off.");
    } catch (e) {
      setError(e.message);
    }
  }

  if (session) {
    return (
      <StudySession
        deck={deck}
        cards={session.cards}
        title={session.title}
        onExit={() => {
          setSession(null);
          // Wait for queued ratings so the strength bars reflect this session.
          flushReviews().finally(loadCards);
        }}
      />
    );
  }

  const weak = weakCards(cards);

  return (
    <div className="decks-page">
      <div className="decks-header">
        <div className="decks-header-left">
          <button className="auth-link" onClick={onBack}>
            ← Decks
          </button>
          <h2>{deck.title}</h2>
        </div>
        <button className="icon-button" onClick={handleShare}>
          {shareToken ? "Share link" : "Share"}
        </button>
      </div>

      {shareToken && (
        <p className="notice">
          {notice || "This deck has a share link."}{" "}
          <button className="auth-link inline-link" onClick={handleStopSharing}>
            Stop sharing
          </button>
        </p>
      )}
      {!shareToken && notice && <p className="notice">{notice}</p>}

      {cards.length > 0 && (
        <div className="study-modes">
          <button
            className="study-mode study-mode-primary"
            onClick={() => setSession({ cards, title: deck.title })}
          >
            <span className="study-mode-name">Study all</span>
            <span className="study-mode-sub">{cards.length} cards</span>
          </button>
          {cards.length > QUICK_SESSION_SIZE && (
            <button
              className="study-mode"
              onClick={() =>
                setSession({ cards: quickCards(cards), title: `${deck.title} · quick 10` })
              }
            >
              <span className="study-mode-name">Quick 10</span>
              <span className="study-mode-sub">random pick</span>
            </button>
          )}
          <button
            className="study-mode"
            disabled={weak.length === 0}
            onClick={() => setSession({ cards: weak, title: `${deck.title} · weak cards` })}
          >
            <span className="study-mode-name">Weak cards</span>
            <span className="study-mode-sub">
              {weak.length === 0 ? "none right now" : `${weak.length} to work on`}
            </span>
          </button>
        </div>
      )}

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
                <StrengthBar value={card.strength} />
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
