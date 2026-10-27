import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { authFetch, fetchSharedDeck, PENDING_SHARE_KEY } from "./api";
import ThemeToggle from "./ThemeToggle";
import OcclusionView from "./OcclusionView";
import "./App.css";

const PREVIEW_COUNT = 6;

// An image with boxes arrives as one card per box; preview it once.
function previewCards(cards) {
  const seen = new Set();
  return cards.filter((c) => {
    const group = c.occlusion?.group;
    if (!group) return true;
    if (seen.has(group)) return false;
    seen.add(group);
    return true;
  });
}

function SharedDeck({ token }) {
  const [deck, setDeck] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSharedDeck(token).then(setDeck).catch((e) => setError(e.message));
  }, [token]);

  async function handleSave() {
    setSaving(true);
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      // Log in first; Decks picks the token up and finishes the save.
      localStorage.setItem(PENDING_SHARE_KEY, token);
      window.location.href = "/";
      return;
    }
    try {
      await authFetch(`/api/shared/${encodeURIComponent(token)}/copy`, { method: "POST" });
      window.location.href = "/";
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <>
      <ThemeToggle />
      <div className="about-page">
        <div className="about-content shared-content">
          <a className="app-brand shared-brand" href="/">Cram</a>

          {error && <p className="auth-message">{error}</p>}
          {!deck && !error && <p className="deck-empty">Loading deck…</p>}

          {deck && (
            <>
              <div>
                <div className="shared-kicker">Shared deck</div>
                <h1>{deck.title}</h1>
                {deck.description && <p>{deck.description}</p>}
                <p className="deck-meta">
                  {deck.cards.length} card{deck.cards.length === 1 ? "" : "s"}
                </p>
              </div>

              <div className="card-list">
                {previewCards(deck.cards).slice(0, PREVIEW_COUNT).map((card, i) =>
                  card.occlusion ? (
                    <div className="card-row" key={i}>
                      <div className="occl-thumb">
                        <OcclusionView src={card.front_image_url} boxes={card.occlusion.boxes} />
                      </div>
                      <span className="card-front">
                        {card.occlusion.boxes.length} hidden part
                        {card.occlusion.boxes.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  ) : (
                    <div className="card-row" key={i}>
                      {card.front_image_url && (
                        <img className="card-thumb" src={card.front_image_url} alt="" />
                      )}
                      <span className="card-front">{card.front_text}</span>
                      <span className="card-back">{card.back_text}</span>
                    </div>
                  )
                )}
                {previewCards(deck.cards).length > PREVIEW_COUNT && (
                  <p className="deck-empty">
                    and {previewCards(deck.cards).length - PREVIEW_COUNT} more
                  </p>
                )}
              </div>

              <button
                className="auth-button auth-button-primary shared-save"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save a copy to my decks"}
              </button>
              <p className="deck-empty">
                You get your own copy to edit. Changes the owner makes later won't reach it.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default SharedDeck;
