require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { createRemoteJWKSet, jwtVerify } = require("jose");
const { pool } = require("./db");
const { supabase } = require("./supabase");

const app = express();

app.use(cors()); // allow all origins for now; we'll lock this to the Vercel domain at deploy time
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
    const { rows } = await pool.query(
      "select * from decks where user_id = $1 order by created_at desc",
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/decks", requireAuth, async (req, res) => {
  const { title, description } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: "title is required" });
  }

  try {
    const { rows } = await pool.query(
      "insert into decks (user_id, title, description) values ($1, $2, $3) returning *",
      [req.user.id, title.trim(), description || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// RLS is off, so every deck/card route has to prove ownership itself. Rather than
// doing that as a separate SELECT — which costs a full round trip to the database
// before the real work starts — each statement below folds `user_id = $n` into its
// own WHERE clause and treats "no rows affected" as a 404.
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
