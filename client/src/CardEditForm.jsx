import { useState } from "react";
import { authFetch, imageChanged, resolveImage } from "./api";
import CardSideField from "./CardSideField";

// Edits one existing card. Used on the deck page and from inside a study
// session; `onSaved` gets the updated card row back from the API.
function CardEditForm({ deckId, card, onSaved, onCancel }) {
  const [front, setFront] = useState(card.front_text || "");
  const [back, setBack] = useState(card.back_text || "");
  const [frontImage, setFrontImage] = useState(
    card.front_image_url ? { url: card.front_image_url } : null
  );
  const [backImage, setBackImage] = useState(
    card.back_image_url ? { url: card.back_image_url } : null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    const body = { frontText: front, backText: back };
    setSaving(true);
    try {
      if (imageChanged(frontImage, card.front_image_url)) {
        body.frontImageUrl = await resolveImage(deckId, frontImage);
      }
      if (imageChanged(backImage, card.back_image_url)) {
        body.backImageUrl = await resolveImage(deckId, backImage);
      }
      const updated = await authFetch(`/api/decks/${deckId}/cards/${card.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      onSaved(updated);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="card-row-editing">
      <div className="card-sides">
        <CardSideField
          label="Front"
          text={front}
          onTextChange={setFront}
          image={frontImage}
          onImageChange={setFrontImage}
        />
        <CardSideField
          label="Back"
          text={back}
          onTextChange={setBack}
          image={backImage}
          onImageChange={setBackImage}
        />
      </div>
      <div className="row-actions">
        <button
          className="auth-button auth-button-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="auth-button auth-button-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="auth-message">{error}</p>}
    </div>
  );
}

export default CardEditForm;
