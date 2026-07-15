require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const app = express();

app.use(cors()); // allow all origins for now; we'll lock this to the Vercel domain at deploy time
app.use(express.json()); // parse JSON request bodies

// ---- auth middleware ----
// Runs before any protected route. Checks the Authorization header,
// verifies the token was signed by Supabase, and attaches the user to the request.
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }

  const token = header.slice(7); // drop "Bearer "

  try {
    const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET);
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

// ---- start ----
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Cram API listening on ${port}`);
});