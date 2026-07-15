import { useRef, useState } from "react";

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Accepts an image via click-to-browse, drag-and-drop, or clipboard paste
// (Ctrl+V) — all three funnel into the same handleFile/onChange path.
function ImageDropZone({ label, value, onChange }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef(null);

  async function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    onChange(await readFileAsDataUrl(file));
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
          <img src={value} alt="" />
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
