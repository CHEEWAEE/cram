// API tests: the real Express app against an in-memory Postgres (PGlite) built
// from schema.sql, with auth tokens signed by a local key that the app fetches
// from a stand-in JWKS endpoint, just as it does from Supabase in production.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

const require = createRequire(import.meta.url);
const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";

let db, jwksServer, apiServer, base, privateKey, issuer;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth; create table auth.users (id uuid primary key);
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
    insert into auth.users values ('${USER_A}'), ('${USER_B}');
  `);
  await db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));

  const keys = await generateKeyPair("ES256");
  privateKey = keys.privateKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "test", alg: "ES256" };
  jwksServer = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((r) => jwksServer.listen(0, r));
  const supabaseUrl = `http://127.0.0.1:${jwksServer.address().port}`;
  issuer = `${supabaseUrl}/auth/v1`;

  process.env.SUPABASE_URL = supabaseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  process.env.VERCEL = "1"; // stops index.js from listening on its own port

  // Swap the real pg pool for PGlite before the app loads it.
  require.cache[require.resolve("../db.js")] = {
    id: require.resolve("../db.js"),
    filename: require.resolve("../db.js"),
    loaded: true,
    exports: { pool: { query: (text, params) => db.query(text, params) } },
  };
  const app = require("../index.js");
  apiServer = app.listen(0);
  await new Promise((r) => apiServer.once("listening", r));
  base = `http://127.0.0.1:${apiServer.address().port}`;
});

after(() => {
  apiServer?.close();
  jwksServer?.close();
});

async function tokenFor(userId) {
  return new SignJWT({ email: `${userId}@test` })
    .setProtectedHeader({ alg: "ES256", kid: "test" })
    .setSubject(userId)
    .setIssuer(issuer)
    .setExpirationTime("1h")
    .sign(privateKey);
}

async function api(path, { user, method = "GET", body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(user ? { authorization: `Bearer ${await tokenFor(user)}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function makeDeck(user, title = "Pharm") {
  const { body } = await api("/api/decks", { user, method: "POST", body: { title } });
  return body.id;
}

test("rejects requests without a valid token", async () => {
  assert.equal((await api("/api/decks")).status, 401);
  const forged = await api("/api/decks", { headers: { authorization: "Bearer nope" } });
  assert.equal(forged.status, 401);
});

test("lists decks with card count and average strength", async () => {
  const deckId = await makeDeck(USER_A, "Counts");
  for (const n of [1, 2]) {
    await api(`/api/decks/${deckId}/cards`, {
      user: USER_A, method: "POST", body: { frontText: `Q${n}`, backText: `A${n}` },
    });
  }
  const { body } = await api("/api/decks", { user: USER_A });
  const deck = body.find((d) => d.id === deckId);
  assert.equal(deck.card_count, 2);
  assert.equal(deck.avg_strength, 0.5);
});

test("a card needs something on both sides", async () => {
  const deckId = await makeDeck(USER_A);
  const res = await api(`/api/decks/${deckId}/cards`, {
    user: USER_A, method: "POST", body: { frontText: "only a front", backText: "  " },
  });
  assert.equal(res.status, 400);
});

test("other users can't see or change your deck", async () => {
  const deckId = await makeDeck(USER_A);
  assert.equal((await api(`/api/decks/${deckId}/cards`, { user: USER_B })).status, 404);
  const add = await api(`/api/decks/${deckId}/cards`, {
    user: USER_B, method: "POST", body: { frontText: "x", backText: "y" },
  });
  assert.equal(add.status, 404);
  const del = await api(`/api/decks/${deckId}`, { user: USER_B, method: "DELETE" });
  assert.equal(del.status, 404);
});

test("a review moves strength toward the rating", async () => {
  const deckId = await makeDeck(USER_A);
  const { body: card } = await api(`/api/decks/${deckId}/cards`, {
    user: USER_A, method: "POST", body: { frontText: "Q", backText: "A" },
  });
  const up = await api(`/api/decks/${deckId}/cards/${card.id}/reviews`, {
    user: USER_A, method: "POST", body: { rating: 3 },
  });
  assert.ok(Math.abs(up.body.strength - 0.65) < 1e-6);
  const bad = await api(`/api/decks/${deckId}/cards/${card.id}/reviews`, {
    user: USER_A, method: "POST", body: { rating: 7 },
  });
  assert.equal(bad.status, 400);
});

test("bulk import keeps the pasted order and checks ownership", async () => {
  const deckId = await makeDeck(USER_A);
  const cards = ["one", "two", "three"].map((w) => ({ frontText: w, backText: w.toUpperCase() }));
  const res = await api(`/api/decks/${deckId}/cards/bulk`, {
    user: USER_A, method: "POST", body: { cards },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.imported, 3);
  const { body: saved } = await api(`/api/decks/${deckId}/cards`, { user: USER_A });
  assert.deepEqual(saved.map((c) => c.front_text), ["one", "two", "three"]);

  const stranger = await api(`/api/decks/${deckId}/cards/bulk`, {
    user: USER_B, method: "POST", body: { cards },
  });
  assert.equal(stranger.status, 404);
  const blank = await api(`/api/decks/${deckId}/cards/bulk`, {
    user: USER_A, method: "POST", body: { cards: [{ frontText: "x", backText: "" }] },
  });
  assert.equal(blank.status, 400);
});

test("share links: public preview, copy into another account, stop sharing", async () => {
  const deckId = await makeDeck(USER_A, "Shared");
  await api(`/api/decks/${deckId}/cards/bulk`, {
    user: USER_A, method: "POST",
    body: { cards: [{ frontText: "a", backText: "1" }, { frontText: "b", backText: "2" }] },
  });
  const first = await api(`/api/decks/${deckId}/share`, { user: USER_A, method: "POST" });
  const again = await api(`/api/decks/${deckId}/share`, { user: USER_A, method: "POST" });
  assert.equal(first.body.shareToken, again.body.shareToken);
  const token = first.body.shareToken;

  const preview = await api(`/api/shared/${token}`);
  assert.equal(preview.body.title, "Shared");
  assert.equal(preview.body.cards.length, 2);
  assert.equal(preview.body.cards[0].id, undefined);

  const copy = await api(`/api/shared/${token}/copy`, { user: USER_B, method: "POST" });
  assert.equal(copy.status, 201);
  assert.equal(copy.body.card_count, 2);
  const { body: copied } = await api(`/api/decks/${copy.body.id}/cards`, { user: USER_B });
  assert.deepEqual(copied.map((c) => c.front_text), ["a", "b"]);

  await api(`/api/decks/${deckId}/share`, { user: USER_A, method: "DELETE" });
  assert.equal((await api(`/api/shared/${token}`)).status, 404);
  assert.equal((await api("/api/shared/not-a-uuid")).status, 404);
});

test("only Cram's own origins get CORS headers", async () => {
  const ok = await api("/health", { headers: { origin: "https://www.appcram.com" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://www.appcram.com");
  const other = await api("/health", { headers: { origin: "https://evil.example" } });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
});
