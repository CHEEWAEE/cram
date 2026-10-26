import { useEffect, useRef, useState } from "react";
import { shrinkImage } from "./shrinkImage";

// One side of a card: a single box that takes text and, optionally, an image.
// The image can be pasted straight into the box (Ctrl+V), dragged onto it, or
// picked with the "Add image" button — all three funnel into handleFile.
//
// `image` is either null, `{ url }` for an image already saved on the card, or
// `{ url, file }` for one the user just picked. The File rides along so the
// parent can upload it to storage on save; the url is only ever for preview.
function CardSideField({ label, text, onTextChange, image, onImageChange, placeholder }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef(null);

  // Previews for freshly picked files are object URLs, which leak unless they're
  // released once this side moves on to a different image.
  useEffect(() => {
    if (!image?.file) return undefined;
    const objectUrl = image.url;
    return () => URL.revokeObjectURL(objectUrl);
  }, [image]);

  async function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const small = await shrinkImage(file);
    onImageChange({ url: URL.createObjectURL(small), file: small });
  }

  return (
    <div
      className={"side-field" + (isDragOver ? " side-field-drag" : "")}
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
      onPaste={(e) => {
        const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
        if (!item) return; // plain text pastes into the box as normal
        e.preventDefault();
        handleFile(item.getAsFile());
      }}
    >
      <div className="side-field-head">
        <span className="side-field-label">{label}</span>
        <button
          type="button"
          className="side-field-upload"
          onClick={() => inputRef.current?.click()}
        >
          {image ? "Replace image" : "Add image"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            handleFile(e.target.files[0]);
            e.target.value = ""; // so picking the same file again still fires
          }}
        />
      </div>

      {image && (
        <div className="side-field-image">
          <img src={image.url} alt="" />
          <button
            type="button"
            className="side-field-remove"
            aria-label="Remove image"
            onClick={() => onImageChange(null)}
          >
            ×
          </button>
        </div>
      )}

      <textarea
        className="side-field-text"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        rows={2}
      />
    </div>
  );
}

export default CardSideField;
