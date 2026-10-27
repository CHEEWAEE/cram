import { useEffect, useState } from "react";
import { authFetch, cachedGet, readCache, resolveImage, writeCache } from "./api";
import CardSideField from "./CardSideField";
import CardEditForm from "./CardEditForm";
import ImportCards from "./ImportCards";
import OcclusionEditor from "./OcclusionEditor";
import OcclusionView from "./OcclusionView";
import StudySession from "./StudySession";
import StrengthBar from "./StrengthBar";
import { flushReviews } from "./reviewSync";
import { QUICK_SESSION_SIZE, quickCards, swapSides, weakCards } from "./cards";

const REVERSE_KEY = "cram.reverse";

function loadReversePref() {
  try {
    return localStorage.getItem(REVERSE_KEY) === "1";
  } catch {
    return false;
  }
}

// Cards made from one image share an occlusion group; the list shows each
// group once, where its first card would have been.
function listItems(cards) {
  const items = [];
  const groups = new Map();
  for (const card of cards) {
    const group = card.occlusion?.group;
    if (!group) {
      items.push({ kind: "basic", card });
    } else if (groups.has(group)) {
      groups.get(group).cards.push(card);
    } else {
      const item = { kind: "occlusion", group, cards: [card] };
      groups.set(group, item);
      items.push(item);
    }
  }
  return items;
}

function averageStrength(cards) {
  return cards.reduce((sum, c) => sum + (c.strength ?? 0), 0) / cards.length;
}

function DeckDetail({ deck, onBack }) {
  const cardsPath = `/api/decks/${deck.id}/cards`;
  // Open on the copy saved last time; loadCards swaps in fresh data.
  const [cards, setCards] = useState(() => readCache(cardsPath) || []);
  const [offline, setOffline] = useState(false);
  const [newCardFront, setNewCardFront] = useState("");
  const [newCardBack, setNewCardBack] = useState("");
  const [newCardFrontImage, setNewCardFrontImage] = useState(null);
  const [newCardBackImage, setNewCardBackImage] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editingCardId, setEditingCardId] = useState(null);
  const [editingGroup, setEditingGroup] = useState(null);
  const [cardKind, setCardKind] = useState("basic"); // "basic" | "occlusion"
  const [occlusionKey, setOcclusionKey] = useState(0); // remounts the editor after a save
  const [importing, setImporting] = useState(false);
  const [reversed, setReversed] = useState(loadReversePref);
  const [session, setSession] = useState(null); // { cards, title } while studying
  const [shareToken, setShareToken] = useState(deck.share_token || null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.id]);

  // Local edits update the list without a reload, so keep the saved copy in
  // step with them for the next time this deck opens.
  useEffect(() => {
    if (!offline) writeCache(cardsPath, cards);
  }, [cards, cardsPath, offline]);

  async function loadCards() {
    try {
      const { data, offline: fromCache } = await cachedGet(cardsPath);
      setCards(data);
      setOffline(fromCache);
    } catch (e) {
      setError(e.message);
    }
  }

  function toggleReversed() {
    const next = !reversed;
    setReversed(next);
    try {
      localStorage.setItem(REVERSE_KEY, next ? "1" : "0");
    } catch {
      // the toggle still works for this visit
    }
  }

  function startSession(sessionCards, title) {
    setSession({
      cards: reversed ? sessionCards.map(swapSides) : sessionCards,
      title: reversed ? `${title} · back to front` : title,
    });
  }

  async function handleCreateCard() {
    const hasFront = newCardFront.trim() || newCardFrontImage;
    const hasBack = newCardBack.trim() || newCardBackImage;
    if (!hasFront || !hasBack) {
      return setError("Each side needs text, an image, or both.");
    }
    setAdding(true);
    try {
      const [frontImageUrl, backImageUrl] = await Promise.all([
        resolveImage(deck.id, newCardFrontImage),
        resolveImage(deck.id, newCardBackImage),
      ]);
      const created = await authFetch(`/api/decks/${deck.id}/cards`, {
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
      setCards((list) => [...list, created]);
    } catch (e) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteCard(card) {
    if (!window.confirm("Delete this card?")) return;
    try {
      await authFetch(`/api/decks/${deck.id}/cards/${card.id}`, {
        method: "DELETE",
      });
      setError("");
      setCards((list) => list.filter((c) => c.id !== card.id));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDeleteGroup(group) {
    if (!window.confirm("Delete this image and all its boxes?")) return;
    try {
      await authFetch(`/api/decks/${deck.id}/occlusions/${group}`, { method: "DELETE" });
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
      setNotice("Link copied");
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
    if (!window.confirm("Turn off the share link?")) {
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
        <div className="row-actions">
          <button className="icon-button" onClick={() => setImporting((v) => !v)}>
            Import
          </button>
          <button className="icon-button" onClick={handleShare}>
            {shareToken ? "Share link" : "Share"}
          </button>
        </div>
      </div>

      {offline && (
        <p className="notice">Offline</p>
      )}

      {shareToken && (
        <p className="notice">
          {notice || "Shared"}{" "}
          <button className="auth-link inline-link" onClick={handleStopSharing}>
            Stop sharing
          </button>
        </p>
      )}
      {!shareToken && notice && <p className="notice">{notice}</p>}

      {importing && (
        <ImportCards
          deckId={deck.id}
          onCancel={() => setImporting(false)}
          onImported={(count) => {
            setImporting(false);
            setNotice(`Imported ${count} card${count === 1 ? "" : "s"}.`);
            loadCards();
          }}
        />
      )}

      {cards.length > 0 && (
        <>
          <div className="study-modes">
            <button
              className="study-mode study-mode-primary"
              onClick={() => startSession(cards, deck.title)}
            >
              <span className="study-mode-name">Study all</span>
              <span className="study-mode-sub">{cards.length} cards</span>
            </button>
            {cards.length > QUICK_SESSION_SIZE && (
              <button
                className="study-mode"
                onClick={() => startSession(quickCards(cards), `${deck.title} · quick 10`)}
              >
                <span className="study-mode-name">Quick 10</span>
                <span className="study-mode-sub">random pick</span>
              </button>
            )}
            <button
              className="study-mode"
              disabled={weak.length === 0}
              onClick={() => startSession(weak, `${deck.title} · weak cards`)}
            >
              <span className="study-mode-name">Weak cards</span>
              <span className="study-mode-sub">
                {weak.length === 0 ? "none right now" : `${weak.length} to work on`}
              </span>
            </button>
          </div>
          <label className="reverse-toggle">
            <input type="checkbox" checked={reversed} onChange={toggleReversed} />
            Study back to front
          </label>
        </>
      )}

      <div className="card-list">
        {listItems(cards).map((item) => {
          if (item.kind === "occlusion") {
            const first = item.cards[0];
            if (editingGroup === item.group) {
              return (
                <div className="card-row-editing" key={item.group}>
                  <OcclusionEditor
                    deckId={deck.id}
                    initial={{
                      group: item.group,
                      imageUrl: first.front_image_url,
                      boxes: first.occlusion.boxes,
                    }}
                    onCancel={() => setEditingGroup(null)}
                    onSaved={() => {
                      setEditingGroup(null);
                      setError("");
                      loadCards();
                    }}
                  />
                </div>
              );
            }
            const labels = first.occlusion.boxes.map((b) => b.label).filter(Boolean);
            return (
              <div className="card-row" key={item.group}>
                <div className="occl-thumb">
                  <OcclusionView src={first.front_image_url} boxes={first.occlusion.boxes} numbered />
                </div>
                <span className="card-front">
                  {item.cards.length} box{item.cards.length === 1 ? "" : "es"}
                </span>
                {labels.length > 0 && <span className="card-back">{labels.join(" · ")}</span>}
                <div className="row-actions">
                  <button className="icon-button" onClick={() => setEditingGroup(item.group)}>
                    Edit
                  </button>
                  <button
                    className="icon-button icon-button-danger"
                    onClick={() => handleDeleteGroup(item.group)}
                  >
                    Delete
                  </button>
                  <StrengthBar value={averageStrength(item.cards)} />
                </div>
              </div>
            );
          }

          const { card } = item;
          return editingCardId === card.id ? (
            <CardEditForm
              key={card.id}
              deckId={deck.id}
              card={card}
              onCancel={() => setEditingCardId(null)}
              onSaved={(updated) => {
                setEditingCardId(null);
                setError("");
                setCards((list) => list.map((c) => (c.id === updated.id ? updated : c)));
              }}
            />
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
                <button className="icon-button" onClick={() => setEditingCardId(card.id)}>
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
          );
        })}
      </div>

      <div className="create-card-form">
        <div className="kind-switch" role="tablist" aria-label="Card type">
          <button
            role="tab"
            aria-selected={cardKind === "basic"}
            className={cardKind === "basic" ? "kind-active" : ""}
            onClick={() => setCardKind("basic")}
          >
            Basic
          </button>
          <button
            role="tab"
            aria-selected={cardKind === "occlusion"}
            className={cardKind === "occlusion" ? "kind-active" : ""}
            onClick={() => setCardKind("occlusion")}
          >
            Image boxes
          </button>
        </div>

        {cardKind === "basic" ? (
          <>
            <div className="card-sides">
              <CardSideField
                label="Front"
                text={newCardFront}
                onTextChange={setNewCardFront}
                image={newCardFrontImage}
                onImageChange={setNewCardFrontImage}
                placeholder="Type, or paste an image"
              />
              <CardSideField
                label="Back"
                text={newCardBack}
                onTextChange={setNewCardBack}
                image={newCardBackImage}
                onImageChange={setNewCardBackImage}
                placeholder="Type, or paste an image"
              />
            </div>
            <button
              className="auth-button auth-button-primary"
              onClick={handleCreateCard}
              disabled={adding}
            >
              {adding ? "Adding…" : "Add card"}
            </button>
          </>
        ) : (
          <OcclusionEditor
            key={occlusionKey}
            deckId={deck.id}
            onSaved={(count) => {
              setOcclusionKey((k) => k + 1);
              setNotice(`Added ${count} card${count === 1 ? "" : "s"} from the image.`);
              loadCards();
            }}
          />
        )}
      </div>

      {error && <p className="auth-message">{error}</p>}
    </div>
  );
}

export default DeckDetail;
