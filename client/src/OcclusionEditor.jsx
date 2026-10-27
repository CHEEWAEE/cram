import { useEffect, useRef, useState } from "react";
import { authFetch, uploadCardImage } from "./api";
import { shrinkImage } from "./shrinkImage";

// Boxes smaller than this (as a fraction of the image) are treated as a stray
// click rather than a box someone meant to draw.
const MIN_SIZE = 0.015;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const newId = () => Math.random().toString(36).slice(2, 10);

// Draw boxes over an image to hide the parts to recall. Drag on the image to
// draw a box, drag a box to move it, Delete removes the selected one. Each
// box becomes its own card. `initial` ({ group, imageUrl, boxes }) edits an
// existing set instead of making a new one.
function OcclusionEditor({ deckId, initial, onSaved, onCancel }) {
  const [image, setImage] = useState(initial ? { url: initial.imageUrl } : null);
  const [boxes, setBoxes] = useState(initial?.boxes || []);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null); // the box being drawn right now
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const surfaceRef = useRef(null);
  const gesture = useRef(null);
  const fileRef = useRef(null);

  // Release the preview URL of a freshly picked image once it's replaced.
  useEffect(() => {
    if (!image?.file) return undefined;
    const url = image.url;
    return () => URL.revokeObjectURL(url);
  }, [image]);

  // Until there's an image, Ctrl+V anywhere on the page pastes one in.
  useEffect(() => {
    if (image) return undefined;
    function onPaste(e) {
      const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
      if (!item) return;
      e.preventDefault();
      handleFile(item.getAsFile());
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [image]);

  // Delete or Backspace removes the selected box, unless someone's typing.
  useEffect(() => {
    function onKey(e) {
      if (!selected || e.target.closest("input, textarea")) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeBox(selected);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  async function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const small = await shrinkImage(file);
    setImage({ url: URL.createObjectURL(small), file: small });
  }

  function pointAt(e) {
    const rect = surfaceRef.current.getBoundingClientRect();
    return {
      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function onSurfaceDown(e) {
    if (e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointAt(e);
    gesture.current = { kind: "draw", start: p };
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    setSelected(null);
  }

  function onBoxDown(e, b) {
    if (e.button > 0) return;
    e.stopPropagation();
    surfaceRef.current.setPointerCapture(e.pointerId);
    gesture.current = { kind: "move", id: b.id, start: pointAt(e), orig: { x: b.x, y: b.y } };
    setSelected(b.id);
  }

  function onSurfaceMove(e) {
    const g = gesture.current;
    if (!g) return;
    const p = pointAt(e);
    if (g.kind === "draw") {
      setDraft({
        x: Math.min(g.start.x, p.x),
        y: Math.min(g.start.y, p.y),
        w: Math.abs(p.x - g.start.x),
        h: Math.abs(p.y - g.start.y),
      });
    } else {
      setBoxes((list) =>
        list.map((b) =>
          b.id === g.id
            ? {
                ...b,
                x: clamp(g.orig.x + p.x - g.start.x, 0, 1 - b.w),
                y: clamp(g.orig.y + p.y - g.start.y, 0, 1 - b.h),
              }
            : b
        )
      );
    }
  }

  function onSurfaceUp() {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === "draw" && draft) {
      if (draft.w >= MIN_SIZE && draft.h >= MIN_SIZE) {
        const box = { ...draft, id: newId(), label: "" };
        setBoxes((list) => [...list, box]);
        setSelected(box.id);
      }
      setDraft(null);
    }
  }

  function removeBox(id) {
    setBoxes((list) => list.filter((b) => b.id !== id));
    setSelected((s) => (s === id ? null : s));
  }

  function setLabel(id, label) {
    setBoxes((list) => list.map((b) => (b.id === id ? { ...b, label } : b)));
  }

  async function handleSave() {
    if (!image) return setError("Add an image first.");
    if (boxes.length === 0) return setError("Drag on the image to cover a part.");
    setSaving(true);
    try {
      const imageUrl = image.file ? await uploadCardImage(deckId, image.file) : image.url;
      const body = JSON.stringify({ imageUrl, boxes });
      if (initial) {
        await authFetch(`/api/decks/${deckId}/occlusions/${initial.group}`, { method: "PUT", body });
      } else {
        await authFetch(`/api/decks/${deckId}/occlusions`, { method: "POST", body });
      }
      onSaved(boxes.length);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        handleFile(e.target.files[0]);
        e.target.value = "";
      }}
    />
  );

  if (!image) {
    return (
      <div
        className={"occl-pick" + (isDragOver ? " side-field-drag" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          handleFile(e.dataTransfer.files[0]);
        }}
      >
        <p>Paste an image with Ctrl+V, drop one here, or</p>
        <button
          type="button"
          className="auth-button auth-button-secondary"
          onClick={() => fileRef.current?.click()}
        >
          Choose an image
        </button>
        {fileInput}
        {onCancel && (
          <button type="button" className="auth-link" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  const shown = draft ? [...boxes, { ...draft, id: "draft" }] : boxes;

  return (
    <div className="occl-editor">
      <p className="deck-empty occl-help">
        Drag over the parts to hide. Each box becomes its own card. Drag a box to
        move it.
      </p>
      <div
        ref={surfaceRef}
        className="occl occl-surface"
        onPointerDown={onSurfaceDown}
        onPointerMove={onSurfaceMove}
        onPointerUp={onSurfaceUp}
        onPointerCancel={onSurfaceUp}
      >
        <img src={image.url} alt="" draggable="false" />
        {shown.map((b, i) => (
          <div
            key={b.id}
            className={
              "occl-box" +
              (b.id === selected ? " occl-box-selected" : "") +
              (b.id === "draft" ? " occl-box-draft" : "")
            }
            style={{
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              width: `${b.w * 100}%`,
              height: `${b.h * 100}%`,
            }}
            onPointerDown={b.id === "draft" ? undefined : (e) => onBoxDown(e, b)}
          >
            {b.id === "draft" ? null : i + 1}
          </div>
        ))}
      </div>

      {boxes.length > 0 && (
        <ol className="occl-labels">
          {boxes.map((b, i) => (
            <li
              key={b.id}
              className={b.id === selected ? "occl-label-selected" : ""}
              onFocus={() => setSelected(b.id)}
            >
              <span className="occl-num">{i + 1}</span>
              <input
                value={b.label}
                onChange={(e) => setLabel(b.id, e.target.value)}
                placeholder="Answer (optional)"
                aria-label={`Answer for box ${i + 1}`}
              />
              <button
                type="button"
                className="icon-button icon-button-danger"
                onClick={() => removeBox(b.id)}
                aria-label={`Remove box ${i + 1}`}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="row-actions occl-actions">
        <button
          className="auth-button auth-button-primary"
          onClick={handleSave}
          disabled={saving || boxes.length === 0}
        >
          {saving
            ? "Saving…"
            : initial
              ? "Save"
              : boxes.length === 0
                ? "Add cards"
                : `Add ${boxes.length} card${boxes.length === 1 ? "" : "s"}`}
        </button>
        <button
          type="button"
          className="auth-button auth-button-secondary"
          onClick={() => fileRef.current?.click()}
        >
          Change image
        </button>
        {onCancel && (
          <button type="button" className="auth-button auth-button-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        {fileInput}
      </div>
      {error && <p className="auth-message">{error}</p>}
    </div>
  );
}

export default OcclusionEditor;
