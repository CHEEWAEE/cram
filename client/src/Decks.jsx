import { useEffect, useRef, useState } from "react";
import { authFetch, cachedGet, PENDING_SHARE_KEY, readCache, writeCache } from "./api";
import DeckDetail from "./DeckDetail";
import StrengthBar from "./StrengthBar";

const DECKS_PATH = "/api/decks";
const FOLDERS_PATH = "/api/folders";
const SORT_KEY = "cram.deckSort";
const FOLDER_KEY = "cram.folder";
const SORTS = {
  newest: { label: "Newest", compare: () => 0 }, // the API already returns newest first
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
  const [sort, setSort] = useState(() => loadPref(SORT_KEY, "newest", (v) => SORTS[v]));
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

  async function loadAll() {
    try {
      const [deckResult, folderResult] = await Promise.all([
        cachedGet(DECKS_PATH),
        cachedGet(FOLDERS_PATH),
      ]);
      setDecks(deckResult.data);
      setFolders(folderResult.data);
      setOffline(deckResult.offline);
    } catch (e) {
      setError(e.message);
    }
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
    if (!window.confirm(`Delete the folder "${folder.name}"? Its decks stay, just outside any folder.`)) {
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
          className={"folder-chip" + (currentFolder === "all" ? " folder-chip-active" : "")}
          onClick={() => openFolder("all")}
        >
          All decks <span className="folder-count">{decks.length}</span>
        </button>
        {folders.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={currentFolder === f.id}
            className={"folder-chip" + (currentFolder === f.id ? " folder-chip-active" : "")}
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
        <p className="notice">
          You're offline. These are the decks saved on this device.
        </p>
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
        {shownDecks.map((deck) =>
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
            <div className="deck-row" key={deck.id}>
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
        {folder && inFolder.length === 0 && (
          <p className="deck-empty">
            This folder is empty. Make a deck below, or move one here with Edit.
          </p>
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
