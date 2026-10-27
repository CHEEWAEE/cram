import { useCallback, useEffect, useRef, useState } from "react";
import { queueReview } from "./reviewSync";
import { shuffle, swapSides } from "./cards";
import CardEditForm from "./CardEditForm";
import OcclusionView from "./OcclusionView";

// Drops the current (front) card and reinserts it `offset` cards ahead —
// small offset for "forgot" (soon), larger for "unsure" (later).
function requeue(queue, offset) {
  const [current, ...rest] = queue;
  const pos = Math.min(offset, rest.length);
  rest.splice(pos, 0, current);
  return rest;
}

const RATINGS = {
  1: { label: "Forgot", direction: "left", offset: 2 },
  2: { label: "Unsure", direction: "up", offset: 6 },
  3: { label: "Remembered", direction: "right", offset: null },
};

// How far a drag has to travel before letting go counts as a rating.
const SWIPE_THRESHOLD = 90;
// Below this, a press-and-release is a tap (flip), not a drag.
const TAP_SLOP = 6;
const EXIT_MS = 220;

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function ratingForDrag(dx, dy) {
  if (dx > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) return 3;
  if (dx < -SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) return 1;
  if (dy < -SWIPE_THRESHOLD) return 2;
  return null;
}

function CardFace({ side, card, hint }) {
  if (card.occlusion) {
    const reveal = side === "back";
    return (
      <div className={`study-face study-face-${side}`}>
        <div className="study-card-label">{reveal ? "Answer" : "What's under the box?"}</div>
        <OcclusionView
          src={card.front_image_url}
          boxes={card.occlusion.boxes}
          target={card.occlusion.target}
          reveal={reveal}
        />
        {reveal && card.back_text && <div className="study-card-text">{card.back_text}</div>}
        <div className="study-card-hint">{hint}</div>
      </div>
    );
  }
  const text = side === "front" ? card.front_text : card.back_text;
  const image = side === "front" ? card.front_image_url : card.back_image_url;
  return (
    <div className={`study-face study-face-${side}`}>
      <div className="study-card-label">{side === "front" ? "Question" : "Answer"}</div>
      {image && <img className="study-card-image" src={image} alt="" draggable="false" />}
      {text && <div className="study-card-text">{text}</div>}
      <div className="study-card-hint">{hint}</div>
    </div>
  );
}

// Built once at load; the same burst every time is fine.
const CONFETTI = Array.from({ length: 48 }, (_, i) => ({
  left: Math.random() * 100,
  delay: Math.random() * 0.6,
  duration: 1.6 + Math.random() * 1.4,
  drift: (Math.random() - 0.5) * 160,
  spin: (Math.random() - 0.5) * 1080,
  color: ["var(--accent)", "var(--good)", "var(--meh)", "var(--bad)"][i % 4],
}));

function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {CONFETTI.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            "--drift": `${p.drift}px`,
            "--spin": `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  );
}

function SessionSummary({ deck, cards, firstRatings, attempts, onRestart, onExit }) {
  const counts = { 1: 0, 2: 0, 3: 0 };
  firstRatings.forEach((r) => (counts[r] += 1));
  const total = cards.length;
  const perfect = total > 0 && counts[3] === total;

  const missed = cards.filter((c) => firstRatings.get(c.id) !== 3);
  const toughest = cards
    .filter((c) => (attempts.get(c.id) || 0) > 1)
    .sort((a, b) => attempts.get(b.id) - attempts.get(a.id))
    .slice(0, 5);

  return (
    <div className="decks-page">
      {perfect && <Confetti />}
      <div className="study-complete">
        <h2>{perfect ? "Clean sweep" : "Session complete"}</h2>
        <p className="deck-empty">
          {perfect
            ? `Every card in "${deck.title}" first time.`
            : `You got through all ${total} card${total === 1 ? "" : "s"} in "${deck.title}".`}
        </p>

        <div className="summary-bar" role="img"
          aria-label={`${counts[3]} remembered, ${counts[2]} unsure, ${counts[1]} forgot`}>
          {[3, 2, 1].map((r) =>
            counts[r] > 0 ? (
              <div key={r} className={`summary-bar-seg summary-${r}`}
                style={{ flexGrow: counts[r] }} />
            ) : null
          )}
        </div>
        <div className="summary-counts">
          <div className="summary-count summary-3"><strong>{counts[3]}</strong> remembered</div>
          <div className="summary-count summary-2"><strong>{counts[2]}</strong> unsure</div>
          <div className="summary-count summary-1"><strong>{counts[1]}</strong> forgot</div>
        </div>

        {toughest.length > 0 && (
          <div className="summary-toughest">
            <div className="summary-heading">Took the most goes</div>
            {toughest.map((c) => (
              <div className="summary-tough-row" key={c.id}>
                <span>{c.front_text || c.back_text || "(image card)"}</span>
                <span className="summary-tough-count">×{attempts.get(c.id)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="summary-actions">
          {missed.length > 0 && (
            <button className="auth-button auth-button-primary" onClick={() => onRestart(missed)}>
              Go over the {missed.length} I missed
            </button>
          )}
          <button className="auth-button auth-button-secondary" onClick={() => onRestart(cards)}>
            Study again
          </button>
          <button className="auth-button auth-button-secondary" onClick={onExit}>
            Back to deck
          </button>
        </div>
      </div>
    </div>
  );
}

function StudySession({ deck, cards: initialCards, title, onExit }) {
  const [cards, setCards] = useState(initialCards);
  const [queue, setQueue] = useState(() => shuffle(initialCards));
  const [flipped, setFlipped] = useState(false);
  // First rating per card is what counts toward strength and the summary;
  // attempts counts every time a card was shown and rated.
  const [firstRatings, setFirstRatings] = useState(() => new Map());
  const [attempts, setAttempts] = useState(() => new Map());
  const [turn, setTurn] = useState(0);
  const [drag, setDrag] = useState({ dx: 0, dy: 0, active: false });
  const [leaving, setLeaving] = useState(null); // rating while the card flies off
  const [editing, setEditing] = useState(false);

  const dragStart = useRef(null);

  const total = cards.length;
  const current = queue[0];
  const progressPct = total === 0 ? 0 : Math.round((firstRatings.size / total) * 100);

  const advance = useCallback(
    (rating) => {
      if (!firstRatings.has(current.id)) {
        queueReview(deck.id, current.id, rating);
        setFirstRatings((prev) => new Map(prev).set(current.id, rating));
      }
      setAttempts((prev) => new Map(prev).set(current.id, (prev.get(current.id) || 0) + 1));

      const { offset } = RATINGS[rating];
      setQueue((q) => (offset === null ? q.slice(1) : requeue(q, offset)));
      setFlipped(false);
      setLeaving(null);
      setDrag({ dx: 0, dy: 0, active: false });
      setTurn((t) => t + 1);
    },
    [current, deck.id, firstRatings]
  );

  const rate = useCallback(
    (rating) => {
      if (!current || !flipped || leaving) return;
      if (prefersReducedMotion()) return advance(rating);
      setLeaving(rating);
      setTimeout(() => advance(rating), EXIT_MS);
    },
    [advance, current, flipped, leaving]
  );

  useEffect(() => {
    function onKey(e) {
      if (editing || e.target.closest("input, textarea")) return;
      if (e.key === " " || e.key === "Enter") {
        if (e.target.closest("button, a")) return; // let focused controls work
        e.preventDefault();
        if (!leaving) setFlipped((f) => !f);
      } else if (e.key === "1" || e.key === "ArrowLeft") rate(1);
      else if (e.key === "2" || e.key === "ArrowUp") rate(2);
      else if (e.key === "3" || e.key === "ArrowRight") rate(3);
      else if (e.key === "e" && !leaving && !queue[0]?.occlusion) setEditing(true);
      else if (e.key === "Escape") onExit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rate, leaving, onExit, editing, queue]);

  // The API hands back the card as stored; in reverse mode the session holds
  // it swapped, so swap the saved copy the same way before putting it back.
  function handleEdited(saved) {
    const updated = current.reversed ? swapSides(saved) : saved;
    const replace = (list) => list.map((c) => (c.id === updated.id ? updated : c));
    setQueue(replace);
    setCards(replace);
    setEditing(false);
  }

  function restart(nextCards) {
    setCards(nextCards);
    setQueue(shuffle(nextCards));
    setFirstRatings(new Map());
    setAttempts(new Map());
    setFlipped(false);
    setTurn((t) => t + 1);
  }

  function onPointerDown(e) {
    if (leaving || e.button > 0) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragStart.current) return;
    setDrag({
      dx: e.clientX - dragStart.current.x,
      dy: e.clientY - dragStart.current.y,
      active: true,
    });
  }

  function onPointerUp() {
    if (!dragStart.current) return;
    dragStart.current = null;
    const { dx, dy } = drag;

    if (Math.hypot(dx, dy) < TAP_SLOP) {
      setDrag({ dx: 0, dy: 0, active: false });
      setFlipped((f) => !f);
      return;
    }
    const rating = flipped ? ratingForDrag(dx, dy) : null;
    if (rating) {
      setLeaving(rating);
      setTimeout(() => advance(rating), prefersReducedMotion() ? 0 : EXIT_MS);
    } else {
      setDrag({ dx: 0, dy: 0, active: false });
    }
  }

  if (!current) {
    return (
      <SessionSummary
        deck={deck}
        cards={cards}
        firstRatings={firstRatings}
        attempts={attempts}
        onRestart={restart}
        onExit={onExit}
      />
    );
  }

  // While dragging the card follows the finger; once rated it flies off in the
  // rating's direction from wherever it was let go.
  let { dx, dy } = drag;
  if (leaving) {
    const dir = RATINGS[leaving].direction;
    if (dir === "right") dx = Math.max(dx, 0) + window.innerWidth;
    if (dir === "left") dx = Math.min(dx, 0) - window.innerWidth;
    if (dir === "up") dy = Math.min(dy, 0) - window.innerHeight;
  }
  const cardStyle = {
    transform: `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`,
    transition: drag.active && !leaving ? "none" : undefined,
  };

  const dragRating = flipped && drag.active ? ratingForDrag(dx, dy) : null;
  const shownRating = leaving || dragRating;

  return (
    <div className="decks-page study-page">
      <div className="study-topbar">
        <button className="auth-link" onClick={onExit}>
          ← End session
        </button>
        <span className="study-deck-title">{title || deck.title}</span>
        <span className="study-progress-label">
          {firstRatings.size} of {total}
        </span>
      </div>
      <div className="study-progress-bar">
        <div className="study-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      {editing ? (
        <CardEditForm
          deckId={deck.id}
          card={current.reversed ? swapSides(current) : current}
          onSaved={handleEdited}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="study-stage">
            <div
              key={turn}
              className={"study-card" + (leaving ? " study-card-leaving" : "")}
              style={cardStyle}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div className={"study-card-inner" + (flipped ? " is-flipped" : "")}>
                <CardFace side="front" card={current} hint="tap to flip" />
                <CardFace side="back" card={current} hint="swipe or pick below" />
              </div>
              {!current.occlusion && (
                <button
                  className="study-card-edit"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setEditing(true)}
                >
                  Edit
                </button>
              )}
              {shownRating && (
                <div className={`study-card-stamp summary-${shownRating}`}>
                  {RATINGS[shownRating].label}
                </div>
              )}
            </div>
          </div>

          <div className={"study-actions" + (flipped ? "" : " study-actions-hidden")}>
            <button className="study-button study-button-forgot" onClick={() => rate(1)} tabIndex={flipped ? 0 : -1}>
              Forgot <kbd>1</kbd>
            </button>
            <button className="study-button study-button-unsure" onClick={() => rate(2)} tabIndex={flipped ? 0 : -1}>
              Unsure <kbd>2</kbd>
            </button>
            <button className="study-button study-button-remembered" onClick={() => rate(3)} tabIndex={flipped ? 0 : -1}>
              Remembered <kbd>3</kbd>
            </button>
          </div>
          <p className="study-keys-hint">
            Space to flip · 1 2 3 to rate{current.occlusion ? "" : " · E to edit"} · Esc to stop
          </p>
        </>
      )}
    </div>
  );
}

export default StudySession;
