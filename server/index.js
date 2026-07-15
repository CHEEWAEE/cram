require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { createRemoteJWKSet, jwtVerify } = require("jose");
const { pool } = require("./db");
const { supabase } = require("./supabase");

const app = express();

app.use(cors()); // allow all origins for now; we'll lock this to the Vercel domain at deploy time
app.use(express.json({ limit: "20mb" })); // parse JSON bodies; raised for base64 card images

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

// A deck belongs to req.user only if this returns a row; RLS is off, so every
// deck/card route must check ownership itself before touching cards.
async function findOwnedDeck(deckId, userId) {
  const { rows } = await pool.query(
    "select id from decks where id = $1 and user_id = $2",
    [deckId, userId]
  );
  return rows[0] || null;
}

app.patch("/api/decks/:deckId", requireAuth, async (req, res) => {
  const deck = await findOwnedDeck(req.params.deckId, req.user.id);
  if (!deck) return res.status(404).json({ error: "Deck not found" });

  const { title, description } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: "title is required" });
  }

  try {
    const { rows } = await pool.query(
      "update decks set title = $1, description = $2, updated_at = now() where id = $3 returning *",
      [title.trim(), description || null, req.params.deckId]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/decks/:deckId", requireAuth, async (req, res) => {
  const deck = await findOwnedDeck(req.params.deckId, req.user.id);
  if (!deck) return res.status(404).json({ error: "Deck not found" });

  try {
    await pool.query("delete from decks where id = $1", [req.params.deckId]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// A card belongs to req.user only if it exists in a deck they own.
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
    const deck = await findOwnedDeck(req.params.deckId, req.user.id);
    if (!deck) return res.status(404).json({ error: "Deck not found" });

    const { rows } = await pool.query(
      "select * from cards where deck_id = $1 order by created_at asc",
      [req.params.deckId]
    );
    res.json(rows);
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

// Card images arrive as data URLs (data:<mime>;base64,<data>) from the
// drag-drop/paste UI; decode and store them in the card-images bucket.
async function uploadCardImage(deckId, dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid image data");
  const [, mime, base64] = match;
  const ext = CARD_IMAGE_EXT_BY_MIME[mime];
  if (!ext) throw new Error(`Unsupported image type: ${mime}`);

  const path = `${deckId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("card-images")
    .upload(path, Buffer.from(base64, "base64"), { contentType: mime });
  if (error) throw error;

  const { data } = supabase.storage.from("card-images").getPublicUrl(path);
  return data.publicUrl;
}

app.post("/api/decks/:deckId/cards", requireAuth, async (req, res) => {
  try {
    const deck = await findOwnedDeck(req.params.deckId, req.user.id);
    if (!deck) return res.status(404).json({ error: "Deck not found" });

    const { frontText, backText, frontImage, backImage } = req.body;
    const hasFront = (frontText && frontText.trim()) || frontImage;
    const hasBack = (backText && backText.trim()) || backImage;
    if (!hasFront || !hasBack) {
      return res
        .status(400)
        .json({ error: "Each side needs text, an image, or both" });
    }

    const [frontImageUrl, backImageUrl] = await Promise.all([
      frontImage ? uploadCardImage(req.params.deckId, frontImage) : null,
      backImage ? uploadCardImage(req.params.deckId, backImage) : null,
    ]);

    const { rows } = await pool.query(
      `insert into cards (deck_id, front_text, back_text, front_image_url, back_image_url)
       values ($1, $2, $3, $4, $5) returning *`,
      [
        req.params.deckId,
        frontText && frontText.trim() ? frontText.trim() : null,
        backText && backText.trim() ? backText.trim() : null,
        frontImageUrl,
        backImageUrl,
      ]
    );
    res.status(201).json(rows[0]);
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

    const { frontText, backText, frontImage, backImage } = req.body;
    const updates = {};
    if (frontText !== undefined) {
      updates.front_text = frontText.trim() ? frontText.trim() : null;
    }
    if (backText !== undefined) {
      updates.back_text = backText.trim() ? backText.trim() : null;
    }
    if (frontImage !== undefined) {
      updates.front_image_url = frontImage
        ? await uploadCardImage(req.params.deckId, frontImage)
        : null;
    }
    if (backImage !== undefined) {
      updates.back_image_url = backImage
        ? await uploadCardImage(req.params.deckId, backImage)
        : null;
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
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/decks/:deckId/cards/:cardId", requireAuth, async (req, res) => {
  try {
    const card = await findOwnedCard(
      req.params.deckId,
      req.params.cardId,
      req.user.id
    );
    if (!card) return res.status(404).json({ error: "Card not found" });

    await pool.query("delete from cards where id = $1", [req.params.cardId]);
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
    try {
      const card = await findOwnedCard(
        req.params.deckId,
        req.params.cardId,
        req.user.id
      );
      if (!card) return res.status(404).json({ error: "Card not found" });

      const { rating } = req.body;
      if (![1, 2, 3].includes(rating)) {
        return res.status(400).json({ error: "rating must be 1, 2, or 3" });
      }

      const newStrength = Math.max(
        0,
        Math.min(
          1,
          card.strength +
            STRENGTH_LEARNING_RATE * (RATING_TARGET[rating] - card.strength)
        )
      );

      await pool.query(
        "insert into reviews (card_id, user_id, rating) values ($1, $2, $3)",
        [req.params.cardId, req.user.id, rating]
      );
      const { rows } = await pool.query(
        "update cards set strength = $1, updated_at = now() where id = $2 returning *",
        [newStrength, req.params.cardId]
      );
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// ---- start ----
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Cram API listening on ${port}`);
});