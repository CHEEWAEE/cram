import { useEffect, useRef, useState } from "react";

// Accepts an image via click-to-browse, drag-and-drop, or clipboard paste
// (Ctrl+V) — all three funnel into the same handleFile/onChange path.
//
// `value` is either null, `{ url }` for an image already saved on the card, or
// `{ url, file }` for one the user just picked. The File rides along so the
// parent can upload it to storage on save; the url is only ever for preview.
function ImageDropZone({ label, value, onChange }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef(null);

  // Previews for freshly picked files are object URLs, which leak unless they're
  // released once this zone moves on to a different image.
  useEffect(() => {
    if (!value?.file) return undefined;
    const objectUrl = value.url;
    return () => URL.revokeObjectURL(objectUrl);
  }, [value]);

  function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    onChange({ url: URL.createObjectURL(file), file });
  }

  return (
    <div
      className={
        "image-dropzone" + (isDragOver ? " image-dropzone-active" : "")
      }
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
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
        const item = [...e.clipboardData.items].find((i) =>
          i.type.startsWith("image/")
        );
        if (item) handleFile(item.getAsFile());
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="image-dropzone-input"
        onChange={(e) => handleFile(e.target.files[0])}
      />
      {value ? (
        <div className="image-dropzone-preview">
          <img src={value.url} alt="" />
          <button
            type="button"
            className="image-dropzone-remove"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <span className="image-dropzone-label">{label}</span>
      )}
    </div>
  );
}

export default ImageDropZone;
