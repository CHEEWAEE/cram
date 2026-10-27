require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { createRemoteJWKSet, jwtVerify } = require("jose");
const { pool } = require("./db");

const app = express();

// Only Cram's own pages may call the API from a browser. ALLOWED_ORIGINS
// (comma-separated) overrides the list, e.g. to let a Vercel preview through.
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  "https://www.appcram.com,https://appcram.com,http://localhost:5173"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// The site and the API live on different domains, so every request with a
// login token is preceded by a CORS preflight. maxAge lets the browser reuse
// the answer for 2 hours (Chrome's cap) instead of re-asking every few seconds,
// which otherwise doubles the round trips on every click.
app.use(cors({ origin: ALLOWED_ORIGINS, maxAge: 7200 }));
app.use(express.json({ limit: "1mb" })); // card images upload straight to storage, so bodies stay small

// Supabase signs auth tokens with project-specific asymmetric keys (ES256),
// published at this JWKS endpoint — there's no shared secret to verify against.
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
);

// ---- auth middleware ----
// Runs before any protected route. Checks the Authorization header,
// verifies the token was signed by Supabase, and attaches the user to the request.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }

  const token = header.slice(7); // drop "Bearer "

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${process.env.SUPABASE_URL}/auth/v1`,
    });
    req.user = { id: payload.sub, email: payload.email }; // sub = the user's UUID
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ---- routes ----
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ userId: req.user.id, email: req.user.email });
});

app.get("/api/decks", requireAuth, async (req, res) => {
  try {
    // Card count and average strength ride along so the deck list can show how
    // big each deck is and how well it's known without a request per deck.
    const { rows } = await pool.query(
      `select decks.*,
              count(cards.id)::int as card_count,
              avg(cards.strength)::float as avg_strength
       from decks
       left join cards on cards.deck_id = decks.id
       where decks.user_id = $1
       group by decks.id
       order by decks.position asc nulls first, decks.created_at desc`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/decks", requireAuth, async (req, res) => {
  const { title, description } = req.body;
  const folderId = req.body.folderId ?? null;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: "title is required" });
  }
  if (folderId !== null && !UUID_RE.test(String(folderId))) {
    return res.status(404).json({ error: "Folder not found" });
  }

  try {
    // An optional folderId files the new deck straight away, if it's yours.
    const { rows } = await pool.query(
      `insert into decks (user_id, title, description, folder_id)
       select $1, $2, $3, $4
       where $4::uuid is null or exists (select 1 from folders where id = $4 and user_id = $1)
       returning *`,
      [req.user.id, title.trim(), description || null, folderId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Folder not found" });
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// The API connects as the table owner, which bypasses RLS, so every deck/card
// route has to prove ownership itself. Rather than doing that as a separate
// SELECT — which costs a full round trip to the database before the real work
// starts — each statement below folds `user_id = $n` into its own WHERE clause
// and treats "no rows affected" as a 404.
app.patch("/api/decks/:deckId", requireAuth, async (req, res) => {
  const { title, description } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: "title is required" });
  }

  try {
    const { rows } = await pool.query(
      `update decks set title = $1, description = $2, updated_at = now()
       where id = $3 and user_id = $4 returning *`,
      [title.trim(), description || null, req.params.deckId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Deck not found" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/decks/:deckId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "delete from decks where id = $1 and user_id = $2 returning id",
      [req.params.deckId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Deck not found" });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// A card belongs to req.user only if it exists in a deck they own. Still needed by
// the card PATCH, which has to read the current row to validate the merged result.
async function findOwnedCard(deckId, cardId, userId) {
  const { rows } = await pool.query(
    `select cards.* from cards
     join decks on decks.id = cards.deck_id
     where cards.id = $1 and cards.deck_id = $2 and decks.user_id = $3`,
    [cardId, deckId, userId]
  );
  return rows[0] || null;
}

app.get("/api/decks/:deckId/cards", requireAuth, async (req, res) => {
  try {
    // LEFT JOIN so an owned-but-empty deck still returns one row (with null card
    // columns) — that's what separates "no cards yet" from "deck isn't yours".
    const { rows } = await pool.query(
      `select decks.id as deck_exists, cards.*
       from decks
       left join cards on cards.deck_id = decks.id
       where decks.id = $1 and decks.user_id = $2
       order by cards.created_at asc`,
      [req.params.deckId, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Deck not found" });

    const cards =
      rows[0].id === null
        ? []
        : rows.map(({ deck_exists, ...card }) => card);
    res.json(cards);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const CARD_IMAGE_EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const PUBLIC_IMAGE_PREFIX = `${process.env.SUPABASE_URL}/storage/v1/object/public/card-images/`;

// Card image URLs arrive from the client after it uploads straight to storage, so
// they're user-controlled strings — only accept ones pointing into our own bucket.
function validateImageUrl(url) {
  if (url === null || url === undefined) return null;
  if (typeof url !== "string" || !url.startsWith(PUBLIC_IMAGE_PREFIX)) {
    throw Object.assign(new Error("Invalid image URL"), { status: 400 });
  }
  return url;
}

// Hands the browser a one-shot upload token so a multi-megabyte image goes
// straight from the user to Supabase Storage instead of being base64'd through
// this API — which used to mean the image crossed the network twice.
app.post("/api/decks/:deckId/uploads", requireAuth, async (req, res) => {
  try {
    const ext = CARD_IMAGE_EXT_BY_MIME[req.body.contentType];
    if (!ext) {
      return res
        .status(400)
        .json({ error: `Unsupported image type: ${req.body.contentType}` });
    }

    const { rows } = await pool.query(
      "select id from decks where id = $1 and user_id = $2",
      [req.params.deckId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Deck not found" });

    // Loaded here rather than at the top: supabase-js is the heaviest import and
    // only uploads use it, so every other cold start skips it.
    const { supabase } = require("./supabase");
    const path = `${req.params.deckId}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await supabase.storage
      .from("card-images")
      .createSignedUploadUrl(path);
    if (error) throw error;

    const { data: pub } = supabase.storage
      .from("card-images")
      .getPublicUrl(path);
    res.json({ path: data.path, token: data.token, publicUrl: pub.publicUrl });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post("/api/decks/:deckId/cards", requireAuth, async (req, res) => {
  try {
    const { frontText, backText, frontImageUrl, backImageUrl } = req.body;
    const front = validateImageUrl(frontImageUrl);
    const back = validateImageUrl(backImageUrl);

    const hasFront = (frontText && frontText.trim()) || front;
    const hasBack = (backText && backText.trim()) || back;
    if (!hasFront || !hasBack) {
      return res
        .status(400)
        .json({ error: "Each side needs text, an image, or both" });
    }

    // INSERT ... SELECT ... WHERE EXISTS folds the ownership check into the write.
    const { rows } = await pool.query(
      `insert into cards (deck_id, front_text, back_text, front_image_url, back_image_url)
       select $1, $2, $3, $4, $5
       where exists (select 1 from decks where id = $1 and user_id = $6)
       returning *`,
      [
        req.params.deckId,
        frontText && frontText.trim() ? frontText.trim() : null,
        backText && backText.trim() ? backText.trim() : null,
        front,
        back,
        req.user.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: "Deck not found" });
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Bulk import: text-only cards from a pasted list. One INSERT for the lot, with
// the ownership check folded in like the single-card route above.
const MAX_IMPORT = 1000;

app.post("/api/decks/:deckId/cards/bulk", requireAuth, async (req, res) => {
  const { cards } = req.body;
  if (!Array.isArray(cards) || cards.length === 0) {
    return res.status(400).json({ error: "cards must be a non-empty list" });
  }
  if (cards.length > MAX_IMPORT) {
    return res.status(400).json({ error: `Import at most ${MAX_IMPORT} cards at a time` });
  }

  const fronts = [];
  const backs = [];
  for (const card of cards) {
    const front = typeof card?.frontText === "string" ? card.frontText.trim() : "";
    const back = typeof card?.backText === "string" ? card.backText.trim() : "";
    if (!front || !back) {
      return res.status(400).json({ error: "Every card needs a front and a back" });
    }
    fronts.push(front);
    backs.push(back);
  }

  try {
    // created_at is staggered by position so the deck keeps the pasted order.
    const { rows } = await pool.query(
      `insert into cards (deck_id, front_text, back_text, created_at)
       select $1, f, b, now() + n * interval '1 millisecond'
       from unnest($2::text[], $3::text[]) with ordinality as t(f, b, n)
       where exists (select 1 from decks where id = $1 and user_id = $4)
       returning id`,
      [req.params.deckId, fronts, backs, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Deck not found" });
    res.status(201).json({ imported: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- image occlusion ----
// Boxes drawn over an image, each hiding one part to recall. Every box becomes
// its own card (so each part has its own strength), and the cards from one
// image share a group id so they can be edited and deleted together.
const MAX_BOXES = 100;
const MAX_LABEL = 300;

function validateOcclusion(body) {
  const fail = (msg) => {
    throw Object.assign(new Error(msg), { status: 400 });
  };
  const imageUrl = validateImageUrl(body.imageUrl);
  if (!imageUrl) fail("An image is required");

  const { boxes } = body;
  if (!Array.isArray(boxes) || boxes.length === 0) fail("Draw at least one box");
  if (boxes.length > MAX_BOXES) fail(`At most ${MAX_BOXES} boxes per image`);

  const seen = new Set();
  const clean = boxes.map((b) => {
    const id = typeof b?.id === "string" ? b.id : "";
    if (!/^[\w-]{1,40}$/.test(id) || seen.has(id)) fail("Each box needs a unique id");
    seen.add(id);
    const [x, y, w, h] = [b.x, b.y, b.w, b.h];
    const inRange = [x, y, w, h].every((n) => Number.isFinite(n) && n >= 0 && n <= 1);
    if (!inRange || w <= 0 || h <= 0 || x + w > 1.001 || y + h > 1.001) {
      fail("Boxes must sit inside the image");
    }
    const label = typeof b.label === "string" ? b.label.trim().slice(0, MAX_LABEL) : "";
    return { id, x, y, w, h, label };
  });
  return { imageUrl, boxes: clean };
}

app.post("/api/decks/:deckId/occlusions", requireAuth, async (req, res) => {
  try {
    const { imageUrl, boxes } = validateOcclusion(req.body);
    const group = crypto.randomUUID();
    const { rows } = await pool.query(
      `insert into cards (deck_id, front_image_url, back_text, occlusion, created_at)
       select $1, $2, nullif(b.label, ''),
              jsonb_build_object('group', $3::text, 'target', b.id, 'boxes', $4::jsonb),
              now() + b.n * interval '1 millisecond'
       from rows from (jsonb_to_recordset($4::jsonb) as (id text, label text))
            with ordinality as b(id, label, n)
       where exists (select 1 from decks where id = $1 and user_id = $5)
       returning *`,
      [req.params.deckId, imageUrl, group, JSON.stringify(boxes), req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Deck not found" });
    res.status(201).json({ group, cards: rows });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Replaces a group's image and boxes. Boxes that kept their id keep their card
// (and its strength); removed boxes lose theirs; new boxes get new cards.
app.put("/api/decks/:deckId/occlusions/:group", requireAuth, async (req, res) => {
  try {
    const { imageUrl, boxes } = validateOcclusion(req.body);
    const { rows } = await pool.query(
      `with existing as (
         select cards.id, cards.occlusion->>'target' as target
         from cards join decks on decks.id = cards.deck_id
         where cards.deck_id = $1 and decks.user_id = $2
           and cards.occlusion->>'group' = $3
       ),
       input as (
         select id, label, n
         from rows from (jsonb_to_recordset($4::jsonb) as (id text, label text))
              with ordinality as t(id, label, n)
       ),
       removed as (
         delete from cards
         where id in (select id from existing
                      where target not in (select id from input))
         returning id
       ),
       kept as (
         update cards
         set front_image_url = $5,
             back_text = nullif(input.label, ''),
             occlusion = jsonb_build_object('group', $3::text, 'target', input.id, 'boxes', $4::jsonb),
             updated_at = now()
         from existing join input on input.id = existing.target
         where cards.id = existing.id
         returning cards.id
       ),
       added as (
         insert into cards (deck_id, front_image_url, back_text, occlusion, created_at)
         select $1, $5, nullif(input.label, ''),
                jsonb_build_object('group', $3::text, 'target', input.id, 'boxes', $4::jsonb),
                now() + input.n * interval '1 millisecond'
         from input
         where exists (select 1 from existing)
           and input.id not in (select target from existing)
         returning id
       )
       select (select count(*) from existing)::int as existing,
              (select count(*) from kept)::int as kept,
              (select count(*) from added)::int as added,
              (select count(*) from removed)::int as removed`,
      [req.params.deckId, req.user.id, req.params.group, JSON.stringify(boxes), imageUrl]
    );
    if (rows[0].existing === 0) return res.status(404).json({ error: "Card not found" });
    const { kept, added, removed } = rows[0];
    res.json({ kept, added, removed });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete("/api/decks/:deckId/occlusions/:group", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `delete from cards using decks
       where cards.deck_id = $1 and decks.id = cards.deck_id and decks.user_id = $2
         and cards.occlusion->>'group' = $3
       returning cards.id`,
      [req.params.deckId, req.user.id, req.params.group]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Card not found" });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/decks/:deckId/cards/:cardId", requireAuth, async (req, res) => {
  try {
    const card = await findOwnedCard(
      req.params.deckId,
      req.params.cardId,
      req.user.id
    );
    if (!card) return res.status(404).json({ error: "Card not found" });

    const { frontText, backText, frontImageUrl, backImageUrl } = req.body;
    const updates = {};
    if (frontText !== undefined) {
      updates.front_text = frontText.trim() ? frontText.trim() : null;
    }
    if (backText !== undefined) {
      updates.back_text = backText.trim() ? backText.trim() : null;
    }
    if (frontImageUrl !== undefined) {
      updates.front_image_url = validateImageUrl(frontImageUrl);
    }
    if (backImageUrl !== undefined) {
      updates.back_image_url = validateImageUrl(backImageUrl);
    }

    const hasFront =
      (updates.front_text !== undefined
        ? !!updates.front_text
        : !!card.front_text) ||
      (updates.front_image_url !== undefined
        ? !!updates.front_image_url
        : !!card.front_image_url);
    const hasBack =
      (updates.back_text !== undefined
        ? !!updates.back_text
        : !!card.back_text) ||
      (updates.back_image_url !== undefined
        ? !!updates.back_image_url
        : !!card.back_image_url);
    if (!hasFront || !hasBack) {
      return res
        .status(400)
        .json({ error: "Each side needs text, an image, or both" });
    }

    const fields = Object.keys(updates);
    if (fields.length === 0) return res.json(card);

    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
    const values = fields.map((f) => updates[f]);
    const { rows } = await pool.query(
      `update cards set ${setClauses}, updated_at = now() where id = $${
        fields.length + 1
      } returning *`,
      [...values, req.params.cardId]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete("/api/decks/:deckId/cards/:cardId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `delete from cards using decks
       where cards.id = $1 and cards.deck_id = $2
         and decks.id = cards.deck_id and decks.user_id = $3
       returning cards.id`,
      [req.params.cardId, req.params.deckId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Card not found" });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Rating targets and learning rate for the strength score: each review nudges
// strength toward 0 (forgot), 0.5 (unsure), or 1 (remembered).
const RATING_TARGET = { 1: 0, 2: 0.5, 3: 1 };
const STRENGTH_LEARNING_RATE = 0.3;

app.post(
  "/api/decks/:deckId/cards/:cardId/reviews",
  requireAuth,
  async (req, res) => {
    const { rating } = req.body;
    if (![1, 2, 3].includes(rating)) {
      return res.status(400).json({ error: "rating must be 1, 2, or 3" });
    }

    try {
      // This is the hottest write in the app — one per card per study session.
      // Ownership check, review log, and strength update all ride in a single
      // statement so a review costs one round trip instead of three.
      const { rows } = await pool.query(
        `with target as (
           select cards.id, cards.strength from cards
           join decks on decks.id = cards.deck_id
           where cards.id = $1 and cards.deck_id = $2 and decks.user_id = $3
         ),
         logged as (
           insert into reviews (card_id, user_id, rating)
           select id, $3, $4 from target
         )
         update cards
         set strength = least(1, greatest(0,
               target.strength + $5 * ($6 - target.strength))),
             updated_at = now()
         from target
         where cards.id = target.id
         returning cards.*`,
        [
          req.params.cardId,
          req.params.deckId,
          req.user.id,
          rating,
          STRENGTH_LEARNING_RATE,
          RATING_TARGET[rating],
        ]
      );
      if (!rows[0]) return res.status(404).json({ error: "Card not found" });
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// Saves the order decks were dragged into. `deckIds` lists the user's decks
// top to bottom; ids that aren't theirs are ignored. Decks made since the last
// reorder have no position and sort to the top, newest first.
const MAX_REORDER = 2000;

app.put("/api/decks/order", requireAuth, async (req, res) => {
  const { deckIds } = req.body;
  if (
    !Array.isArray(deckIds) ||
    deckIds.length > MAX_REORDER ||
    !deckIds.every((id) => typeof id === "string" && UUID_RE.test(id))
  ) {
    return res.status(400).json({ error: "deckIds must be a list of deck ids" });
  }
  try {
    const { rows } = await pool.query(
      `update decks set position = t.n
       from unnest($1::uuid[]) with ordinality as t(id, n)
       where decks.id = t.id and decks.user_id = $2
       returning decks.id`,
      [deckIds, req.user.id]
    );
    res.json({ updated: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- folders ----
// One level of folders for grouping decks. Deleting a folder keeps its decks;
// they just go back to having no folder.
const MAX_FOLDER_NAME = 60;

function folderName(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) throw Object.assign(new Error("Folder name is required"), { status: 400 });
  return name.slice(0, MAX_FOLDER_NAME);
}

app.get("/api/folders", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "select * from folders where user_id = $1 order by lower(name)",
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/folders", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "insert into folders (user_id, name) values ($1, $2) returning *",
      [req.user.id, folderName(req.body)]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.patch("/api/folders/:folderId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "update folders set name = $1 where id = $2 and user_id = $3 returning *",
      [folderName(req.body), req.params.folderId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Folder not found" });
    res.json(rows[0]);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete("/api/folders/:folderId", requireAuth, async (req, res) => {
  try {
    // decks.folder_id is "on delete set null", so the decks stay put.
    const { rows } = await pool.query(
      "delete from folders where id = $1 and user_id = $2 returning id",
      [req.params.folderId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Folder not found" });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Moves a deck into a folder, or out of one with { folderId: null }. Both the
// deck and the folder have to be yours.
app.put("/api/decks/:deckId/folder", requireAuth, async (req, res) => {
  const folderId = req.body?.folderId ?? null;
  if (folderId !== null && !UUID_RE.test(String(folderId))) {
    return res.status(404).json({ error: "Deck or folder not found" });
  }
  try {
    const { rows } = await pool.query(
      `update decks set folder_id = $1, updated_at = now()
       where id = $2 and user_id = $3
         and ($1::uuid is null or exists (
           select 1 from folders where id = $1 and user_id = $3))
       returning *`,
      [folderId, req.params.deckId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Deck or folder not found" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- sharing ----
// A shared deck is reachable by anyone holding its random token. Saving one makes
// an independent copy in the saver's account: no live link back, fresh strength
// scores, and the original owner can stop sharing without touching the copies.

app.post("/api/decks/:deckId/share", requireAuth, async (req, res) => {
  try {
    const token = crypto.randomUUID(); // share_token is a uuid column
    // coalesce keeps an existing token, so sharing twice gives the same link.
    const { rows } = await pool.query(
      `update decks set share_token = coalesce(share_token, $1)
       where id = $2 and user_id = $3 returning share_token`,
      [token, req.params.deckId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Deck not found" });
    res.json({ shareToken: rows[0].share_token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/decks/:deckId/share", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `update decks set share_token = null
       where id = $1 and user_id = $2 returning id`,
      [req.params.deckId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Deck not found" });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Public: no auth, and only the card content goes out, never ids or owner.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// share_token is a uuid column, so anything else would make Postgres throw.
function requireShareToken(req, res, next) {
  if (!UUID_RE.test(req.params.token)) {
    return res.status(404).json({ error: "This share link doesn't exist any more" });
  }
  next();
}

app.get("/api/shared/:token", requireShareToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select decks.title, decks.description,
              cards.front_text, cards.back_text,
              cards.front_image_url, cards.back_image_url, cards.occlusion
       from decks
       left join cards on cards.deck_id = decks.id
       where decks.share_token = $1
       order by cards.created_at asc`,
      [req.params.token]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "This share link doesn't exist any more" });
    }
    const { title, description } = rows[0];
    const cards = rows
      .filter((r) => r.front_text || r.back_text || r.front_image_url || r.back_image_url)
      .map(({ title, description, ...card }) => card);
    res.json({ title, description, cards });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/shared/:token/copy", requireShareToken, requireAuth, async (req, res) => {
  try {
    // One statement: new deck, then its cards. Images aren't duplicated; the copy
    // points at the same files in storage, which are never deleted with a card.
    // created_at is staggered by row so the copy keeps the original card order.
    const { rows } = await pool.query(
      `with src as (
         select id, title, description from decks where share_token = $1
       ),
       new_deck as (
         insert into decks (user_id, title, description)
         select $2, title, description from src
         returning *
       ),
       copied as (
         insert into cards (deck_id, front_text, back_text,
                            front_image_url, back_image_url, occlusion, created_at)
         select new_deck.id, c.front_text, c.back_text,
                c.front_image_url, c.back_image_url, c.occlusion,
                now() + row_number() over (order by c.created_at) * interval '1 millisecond'
         from new_deck, src
         join cards c on c.deck_id = src.id
         returning id
       )
       select new_deck.*, (select count(*) from copied)::int as card_count
       from new_deck`,
      [req.params.token, req.user.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "This share link doesn't exist any more" });
    }
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- start ----
// On Vercel the platform invokes the exported app directly; the listener is only
// for `npm run dev` locally.
if (!process.env.VERCEL) {
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Cram API listening on ${port}`);
  });
}

module.exports = app;
