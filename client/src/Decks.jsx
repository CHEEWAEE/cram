import { useEffect, useRef, useState } from "react";
import { authFetch, cachedGet, PENDING_SHARE_KEY, readCache, writeCache } from "./api";
import DeckDetail from "./DeckDetail";
import StrengthBar from "./StrengthBar";

const DECKS_PATH = "/api/decks";
const FOLDERS_PATH = "/api/folders";
const SORT_KEY = "cram.deckSort";
const FOLDER_KEY = "cram.folder";
const SORTS = {
  custom: { label: "My order", compare: () => 0 }, // the API returns decks in this order
  newest: { label: "Newest", compare: (a, b) => b.created_at.localeCompare(a.created_at) },
  az: { label: "A–Z", compare: (a, b) => a.title.localeCompare(b.title) },
  weakest: {
    label: "Weakest first",
    // Empty decks have no strength to speak of, so they sink to the bottom.
    compare: (a, b) => (a.avg_strength ?? 2) - (b.avg_strength ?? 2),
  },
  biggest: { label: "Most cards", compare: (a, b) => (b.card_count ?? 0) - (a.card_count ?? 0) },
};
// Search and sort only earn their space once there are a few decks.
const TOOLS_FROM = 4;
// Matches the gap between deck rows in the CSS.
const ROW_GAP = 12;
// How close to the top or bottom of the screen a drag starts scrolling.
const SCROLL_EDGE = 70;

function loadPref(key, fallback, isValid = () => true) {
  try {
    const saved = localStorage.getItem(key);
    return saved !== null && isValid(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function savePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // still works for this visit
  }
}

function Decks() {
  // Start from the copies saved last time so the page is never blank while
  // the API wakes up; loadAll swaps in fresh data.
  const [decks, setDecks] = useState(() => readCache(DECKS_PATH) || []);
  const [folders, setFolders] = useState(() => readCache(FOLDERS_PATH) || []);
  const [activeFolder, setActiveFolder] = useState(() => loadPref(FOLDER_KEY, "all"));
  const [selectedDeck, setSelectedDeck] = useState(null);
  const [newDeckTitle, setNewDeckTitle] = useState("");
  const [newDeckDescription, setNewDeckDescription] = useState("");
  const [editingDeckId, setEditingDeckId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editFolder, setEditFolder] = useState("");
  const [folderDraft, setFolderDraft] = useState(null); // text while naming a new folder
  const [renameDraft, setRenameDraft] = useState(null); // text while renaming the open folder
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [offline, setOffline] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(() => loadPref(SORT_KEY, "custom", (v) => SORTS[v]));
  // While a deck is being dragged: which row, how far it has moved, where it
  // would land, and which folder pill (if any) it's over.
  const [drag, setDrag] = useState(null);
  const rowRefs = useRef(new Map());
  // The folder name boxes save on Enter and on blur; this stops one typing
  // session from saving twice when both happen.
  const folderBusy = useRef(false);

  useEffect(() => {
    // Someone who opened a share link while logged out lands here after
    // logging in; finish saving the deck they asked for.
    const pending = localStorage.getItem(PENDING_SHARE_KEY);
    if (pending) {
      localStorage.removeItem(PENDING_SHARE_KEY);
      authFetch(`/api/shared/${pending}/copy`, { method: "POST" })
        .then((deck) => setNotice(`Saved "${deck.title}" to your decks.`))
        .catch((e) => setError(e.message))
        .finally(loadAll);
    } else {
      loadAll();
    }
  }, []);

  // Edits below update state in place rather than reloading, so the saved
  // copies follow along.
  useEffect(() => {
    if (!offline) writeCache(DECKS_PATH, decks);
  }, [decks, offline]);
  useEffect(() => {
    if (!offline) writeCache(FOLDERS_PATH, folders);
  }, [folders, offline]);

  // A folder that's been deleted elsewhere drops you back to All.
  const folder = folders.find((f) => f.id === activeFolder) || null;
  const currentFolder = folder ? folder.id : "all";

  // Decks and folders load side by side but independently: if folders fail
  // (say, mid-deploy), the decks still show.
  async function loadAll() {
    const [deckResult, folderResult] = await Promise.allSettled([
      cachedGet(DECKS_PATH),
      cachedGet(FOLDERS_PATH),
    ]);
    if (deckResult.status === "fulfilled") {
      setDecks(deckResult.value.data);
      setOffline(deckResult.value.offline);
    } else {
      setError(deckResult.reason.message);
    }
    if (folderResult.status === "fulfilled") setFolders(folderResult.value.data);
  }

  function changeSort(next) {
    setSort(next);
    savePref(SORT_KEY, next);
  }

  function openFolder(id) {
    setActiveFolder(id);
    setRenameDraft(null);
    savePref(FOLDER_KEY, id);
  }

  async function handleCreateFolder() {
    const name = (folderDraft || "").trim();
    if (!name) return setFolderDraft(null);
    if (folderBusy.current) return;
    folderBusy.current = true;
    try {
      const created = await authFetch(FOLDERS_PATH, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setFolders((list) =>
        [...list, created].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      );
      setFolderDraft(null);
      setError("");
      openFolder(created.id);
    } catch (e) {
      setError(e.message);
    } finally {
      folderBusy.current = false;
    }
  }

  async function handleRenameFolder() {
    const name = (renameDraft || "").trim();
    if (!name || name === folder.name) return setRenameDraft(null);
    if (folderBusy.current) return;
    folderBusy.current = true;
    try {
      const updated = await authFetch(`/api/folders/${folder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setFolders((list) => list.map((f) => (f.id === updated.id ? updated : f)));
      setRenameDraft(null);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      folderBusy.current = false;
    }
  }

  async function handleDeleteFolder() {
    if (!window.confirm(`Delete the folder "${folder.name}"?`)) {
      return;
    }
    try {
      await authFetch(`/api/folders/${folder.id}`, { method: "DELETE" });
      setFolders((list) => list.filter((f) => f.id !== folder.id));
      setDecks((list) =>
        list.map((d) => (d.folder_id === folder.id ? { ...d, folder_id: null } : d))
      );
      setError("");
      openFolder("all");
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleCreateDeck() {
    if (!newDeckTitle.trim()) return setError("Deck title is required.");
    try {
      const created = await authFetch(DECKS_PATH, {
        method: "POST",
        body: JSON.stringify({
          title: newDeckTitle,
          description: newDeckDescription,
          folderId: folder ? folder.id : null,
        }),
      });
      setDecks((list) => [{ ...created, card_count: 0, avg_strength: null }, ...list]);
      setNewDeckTitle("");
      setNewDeckDescription("");
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  function startEditDeck(deck) {
    setEditingDeckId(deck.id);
    setEditTitle(deck.title);
    setEditDescription(deck.description || "");
    setEditFolder(deck.folder_id || "");
  }

  async function handleSaveDeck(deck) {
    if (!editTitle.trim()) return setError("Deck title is required.");
    try {
      const [updated, moved] = await Promise.all([
        authFetch(`/api/decks/${deck.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: editTitle, description: editDescription }),
        }),
        editFolder !== (deck.folder_id || "")
          ? authFetch(`/api/decks/${deck.id}/folder`, {
              method: "PUT",
              body: JSON.stringify({ folderId: editFolder || null }),
            })
          : null,
      ]);
      // The PATCH reply has no card stats, so keep the ones already shown.
      setDecks((list) =>
        list.map((d) =>
          d.id === deck.id
            ? { ...d, title: updated.title, description: updated.description,
                folder_id: moved ? moved.folder_id : d.folder_id }
            : d
        )
      );
      setEditingDeckId(null);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDeleteDeck(deck) {
    if (!window.confirm(`Delete "${deck.title}" and all its cards? This can't be undone.`)) {
      return;
    }
    try {
      await authFetch(`/api/decks/${deck.id}`, { method: "DELETE" });
      setDecks((list) => list.filter((d) => d.id !== deck.id));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  async function moveToFolder(deck, folderId) {
    if ((deck.folder_id || null) === folderId) return;
    setDecks((list) => list.map((d) => (d.id === deck.id ? { ...d, folder_id: folderId } : d)));
    try {
      await authFetch(`/api/decks/${deck.id}/folder`, {
        method: "PUT",
        body: JSON.stringify({ folderId }),
      });
      const where = folderId ? `into ${folders.find((f) => f.id === folderId)?.name}` : "out of its folder";
      setNotice(`Moved "${deck.title}" ${where}.`);
      setError("");
    } catch (e) {
      setError(e.message);
      loadAll();
    }
  }

  // Moves one of the shown decks from one slot to another. The shown decks
  // may be a slice of the full list (a folder, say), so the new arrangement is
  // written back into the slots those decks held, and the whole list saved.
  async function reorder(shown, from, to) {
    if (from === to || to < 0 || to >= shown.length) return;
    const moved = [...shown];
    const [deck] = moved.splice(from, 1);
    moved.splice(to, 0, deck);

    const movedIds = new Set(moved.map((d) => d.id));
    let k = 0;
    const next = [...decks]
      .sort(SORTS[sort].compare)
      .map((d) => (movedIds.has(d.id) ? moved[k++] : d))
      .map((d, i) => ({ ...d, position: i + 1 }));

    setDecks(next);
    changeSort("custom"); // what you see is now your order
    try {
      await authFetch("/api/decks/order", {
        method: "PUT",
        body: JSON.stringify({ deckIds: next.map((d) => d.id) }),
      });
    } catch (e) {
      setError(e.message);
      loadAll();
    }
  }

  function startDrag(e, shown, index) {
    if (e.button > 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Row positions in page coordinates, so scrolling mid-drag doesn't skew them.
    const slots = shown.map((d) => {
      const r = rowRefs.current.get(d.id).getBoundingClientRect();
      return { top: r.top + window.scrollY, height: r.height };
    });
    setDrag({ id: shown[index].id, index, startY: e.clientY + window.scrollY, dy: 0, slots, target: index, folder: null });
  }

  function moveDrag(e) {
    if (!drag) return;
    if (e.clientY < SCROLL_EDGE) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - SCROLL_EDGE) window.scrollBy(0, 12);

    const dy = e.clientY + window.scrollY - drag.startY;
    const me = drag.slots[drag.index];
    const center = me.top + me.height / 2 + dy;
    const target = drag.slots.filter((s, j) => j !== drag.index && s.top + s.height / 2 < center).length;
    // The dragged row sits under the pointer, so look beneath it for a pill.
    const pill = document
      .elementsFromPoint(e.clientX, e.clientY)
      .map((el) => el.closest("[data-folder-drop]"))
      .find(Boolean);
    setDrag({ ...drag, dy, target, folder: pill ? pill.dataset.folderDrop : null });
  }

  function endDrag(shown) {
    if (!drag) return;
    const deck = shown[drag.index];
    if (drag.folder !== null) moveToFolder(deck, drag.folder === "none" ? null : drag.folder);
    else reorder(shown, drag.index, drag.target);
    setDrag(null);
  }

  // How far a row slides to open a gap where the dragged deck would land.
  function rowShift(i) {
    if (!drag || drag.folder !== null || i === drag.index) return 0;
    const { index: d, target: t } = drag;
    const room = drag.slots[d].height + ROW_GAP;
    if (d < t && i > d && i <= t) return -room;
    if (d > t && i >= t && i < d) return room;
    return 0;
  }

  if (selectedDeck) {
    return (
      <DeckDetail
        deck={selectedDeck}
        onBack={() => {
          setSelectedDeck(null);
          loadAll(); // card counts and strength may have changed
        }}
      />
    );
  }

  const folderName = (id) => folders.find((f) => f.id === id)?.name;
  const inFolder = folder ? decks.filter((d) => d.folder_id === folder.id) : decks;
  const needle = query.trim().toLowerCase();
  const shownDecks = inFolder
    .filter(
      (d) =>
        !needle ||
        d.title.toLowerCase().includes(needle) ||
        (d.description || "").toLowerCase().includes(needle)
    )
    .sort(SORTS[sort].compare);

  return (
    <div className="decks-page">
      <div className="folder-bar" role="tablist" aria-label="Folders">
        <button
          role="tab"
          aria-selected={currentFolder === "all"}
          data-folder-drop="none"
          className={
            "folder-chip" +
            (currentFolder === "all" ? " folder-chip-active" : "") +
            (drag ? " folder-chip-droppable" : "") +
            (drag?.folder === "none" ? " folder-chip-over" : "")
          }
          onClick={() => openFolder("all")}
        >
          All decks <span className="folder-count">{decks.length}</span>
        </button>
        {folders.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={currentFolder === f.id}
            data-folder-drop={f.id}
            className={
              "folder-chip" +
              (currentFolder === f.id ? " folder-chip-active" : "") +
              (drag ? " folder-chip-droppable" : "") +
              (drag?.folder === f.id ? " folder-chip-over" : "")
            }
            onClick={() => openFolder(f.id)}
          >
            {f.name}{" "}
            <span className="folder-count">{decks.filter((d) => d.folder_id === f.id).length}</span>
          </button>
        ))}
        {folderDraft === null ? (
          <button className="folder-chip folder-chip-new" onClick={() => setFolderDraft("")}>
            + Folder
          </button>
        ) : (
          <input
            className="folder-chip folder-input"
            autoFocus
            value={folderDraft}
            onChange={(e) => setFolderDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateFolder();
              if (e.key === "Escape") setFolderDraft(null);
            }}
            onBlur={handleCreateFolder}
            placeholder="Folder name"
            maxLength={60}
            aria-label="New folder name"
          />
        )}
      </div>

      <div className="decks-header">
        {folder && renameDraft !== null ? (
          <input
            className="folder-rename"
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameFolder();
              if (e.key === "Escape") setRenameDraft(null);
            }}
            onBlur={handleRenameFolder}
            maxLength={60}
            aria-label="Folder name"
          />
        ) : (
          <h2>{folder ? folder.name : "Your decks"}</h2>
        )}
        {folder && renameDraft === null && (
          <div className="row-actions">
            <button className="icon-button" onClick={() => setRenameDraft(folder.name)}>
              Rename
            </button>
            <button className="icon-button icon-button-danger" onClick={handleDeleteFolder}>
              Delete folder
            </button>
          </div>
        )}
      </div>

      {notice && <p className="notice">{notice}</p>}
      {offline && (
        <p className="notice">Offline</p>
      )}

      {inFolder.length >= TOOLS_FROM && (
        <div className="deck-tools">
          <input
            className="deck-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search decks"
            aria-label="Search decks"
          />
          <select
            className="deck-sort"
            value={sort}
            onChange={(e) => changeSort(e.target.value)}
            aria-label="Sort decks"
          >
            {Object.entries(SORTS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="deck-list">
        {shownDecks.map((deck, i) =>
          editingDeckId === deck.id ? (
            <div className="deck-row-editing" key={deck.id}>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Title"
              />
              <input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Description (optional)"
              />
              {folders.length > 0 && (
                <select
                  className="deck-sort"
                  value={editFolder}
                  onChange={(e) => setEditFolder(e.target.value)}
                  aria-label="Folder"
                >
                  <option value="">No folder</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}
              <div className="row-actions">
                <button
                  className="auth-button auth-button-primary"
                  onClick={() => handleSaveDeck(deck)}
                >
                  Save
                </button>
                <button
                  className="auth-button auth-button-secondary"
                  onClick={() => setEditingDeckId(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              className={"deck-row" + (drag?.id === deck.id ? " deck-row-dragging" : "")}
              key={deck.id}
              ref={(el) => (el ? rowRefs.current.set(deck.id, el) : rowRefs.current.delete(deck.id))}
              style={{
                transform:
                  drag?.id === deck.id
                    ? `translateY(${drag.dy}px)${drag.folder !== null ? " scale(0.96)" : ""}`
                    : `translateY(${rowShift(i)}px)`,
              }}
            >
              {!needle && (
                <button
                  className="drag-handle"
                  aria-label={`Move ${deck.title}. Drag, or use the arrow keys`}
                  onPointerDown={(e) => startDrag(e, shownDecks, i)}
                  onPointerMove={moveDrag}
                  onPointerUp={() => endDrag(shownDecks)}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                      e.preventDefault();
                      reorder(shownDecks, i, e.key === "ArrowUp" ? i - 1 : i + 1);
                    }
                  }}
                >
                  ⠿
                </button>
              )}
              <button
                className="deck-row-main"
                onClick={() => setSelectedDeck(deck)}
              >
                <span className="deck-title">{deck.title}</span>
                {deck.description && (
                  <span className="deck-description">{deck.description}</span>
                )}
                <span className="deck-meta">
                  {deck.card_count ?? 0} card{deck.card_count === 1 ? "" : "s"}
                  {deck.card_count > 0 && <StrengthBar value={deck.avg_strength} />}
                  {!folder && folderName(deck.folder_id) && (
                    <span className="deck-folder-tag">{folderName(deck.folder_id)}</span>
                  )}
                </span>
              </button>
              <div className="row-actions">
                <button className="icon-button" onClick={() => startEditDeck(deck)}>
                  Edit
                </button>
                <button
                  className="icon-button icon-button-danger"
                  onClick={() => handleDeleteDeck(deck)}
                >
                  Delete
                </button>
              </div>
            </div>
          )
        )}
        {inFolder.length > 0 && shownDecks.length === 0 && (
          <p className="deck-empty">No decks match "{query.trim()}".</p>
        )}
      </div>

      <div className="create-deck-form">
        <label className="auth-field">
          Title
          <input
            value={newDeckTitle}
            onChange={(e) => setNewDeckTitle(e.target.value)}
            placeholder="e.g. Cardiovascular Pharm"
          />
        </label>
        <label className="auth-field">
          Description
          <input
            value={newDeckDescription}
            onChange={(e) => setNewDeckDescription(e.target.value)}
            placeholder="optional"
          />
        </label>
        <button
          className="auth-button auth-button-primary"
          onClick={handleCreateDeck}
        >
          {folder ? `Create deck in ${folder.name}` : "Create deck"}
        </button>
      </div>

      {error && <p className="auth-message">{error}</p>}
    </div>
  );
}

export default Decks;
