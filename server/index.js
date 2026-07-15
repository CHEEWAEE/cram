require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createRemoteJWKSet, jwtVerify } = require("jose");
const { pool } = require("./db");

const app = express();

app.use(cors()); // allow all origins for now; we'll lock this to the Vercel domain at deploy time
app.use(express.json()); // parse JSON request bodies

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

app.post("/api/decks/:deckId/cards", requireAuth, async (req, res) => {
  try {
    const deck = await findOwnedDeck(req.params.deckId, req.user.id);
    if (!deck) return res.status(404).json({ error: "Deck not found" });

    const { frontText, backText } = req.body;
    if (!frontText || !frontText.trim() || !backText || !backText.trim()) {
      return res
        .status(400)
        .json({ error: "frontText and backText are required" });
    }

    const { rows } = await pool.query(
      "insert into cards (deck_id, front_text, back_text) values ($1, $2, $3) returning *",
      [req.params.deckId, frontText.trim(), backText.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- start ----
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Cram API listening on ${port}`);
});