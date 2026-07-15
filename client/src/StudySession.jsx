import { useState } from "react";
import { authFetch } from "./api";

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Drops the current (front) card and reinserts it `offset` cards ahead —
// small offset for "forgot" (soon), larger for "unsure" (later).
function requeue(queue, offset) {
  const [current, ...rest] = queue;
  const pos = Math.min(offset, rest.length);
  rest.splice(pos, 0, current);
  return rest;
}

function StudySession({ deck, cards, onExit }) {
  const [queue, setQueue] = useState(() => shuffle(cards));
  const [flipped, setFlipped] = useState(false);
  const [ratedIds, setRatedIds] = useState(() => new Set());
  const [error, setError] = useState("");

  const total = cards.length;
  const ratedCount = ratedIds.size;
  const current = queue[0];

  async function handleRate(rating) {
    if (!current) return;

    // Only the first rating a card gets this session counts toward its
    // strength score and the review log — repeats from the requeue are
    // practice only.
    if (!ratedIds.has(current.id)) {
      try {
        await authFetch(`/api/decks/${deck.id}/cards/${current.id}/reviews`, {
          method: "POST",
          body: JSON.stringify({ rating }),
        });
      } catch (e) {
        setError(e.message);
      }
      setRatedIds((prev) => new Set(prev).add(current.id));
    }

    if (rating === 3) {
      setQueue(queue.slice(1)); // remembered — leaves the queue
    } else if (rating === 1) {
      setQueue(requeue(queue, 2)); // forgot — comes back soon
    } else {
      setQueue(requeue(queue, 6)); // unsure — comes back later
    }
    setFlipped(false);
  }

  if (!current) {
    return (
      <div className="decks-page">
        <div className="study-complete">
          <h2>Session complete</h2>
          <p className="deck-empty">
            You rated all {total} card{total === 1 ? "" : "s"} in "{deck.title}".
          </p>
          <button className="auth-button auth-button-primary" onClick={onExit}>
            Back to deck
          </button>
        </div>
      </div>
    );
  }

  const progressPct = total === 0 ? 0 : Math.round((ratedCount / total) * 100);

  return (
    <div className="decks-page">
      <div className="study-topbar">
        <button className="auth-link" onClick={onExit}>
          ← End session
        </button>
        <span className="study-deck-title">{deck.title}</span>
        <span className="study-progress-label">
          {ratedCount} of {total}
        </span>
      </div>
      <div className="study-progress-bar">
        <div className="study-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="study-card" onClick={() => setFlipped((f) => !f)}>
        <div className="study-card-label">{flipped ? "Answer" : "Question"}</div>
        {!flipped ? (
          <>
            {current.front_image_url && (
              <img className="study-card-image" src={current.front_image_url} alt="" />
            )}
            <div className="study-card-text">{current.front_text}</div>
          </>
        ) : (
          <>
            {current.back_image_url && (
              <img className="study-card-image" src={current.back_image_url} alt="" />
            )}
            <div className="study-card-text">{current.back_text}</div>
          </>
        )}
        <div className="study-card-hint">
          {flipped ? "tap to flip back" : "tap to flip"}
        </div>
      </div>

      {flipped && (
        <div className="study-actions">
          <button className="study-button-forgot" onClick={() => handleRate(1)}>
            Forgot
          </button>
          <button className="study-button-unsure" onClick={() => handleRate(2)}>
            Unsure
          </button>
          <button className="study-button-remembered" onClick={() => handleRate(3)}>
            Remembered
          </button>
        </div>
      )}

      {error && <p className="auth-message">{error}</p>}
    </div>
  );
}

export default StudySession;
