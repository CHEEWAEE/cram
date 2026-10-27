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

// Card image URLs must point into our storage bucket.
const img = (name) => `${process.env.SUPABASE_URL}/storage/v1/object/public/card-images/${name}.png`;
const box = (id, label = "", x = 0.1) => ({ id, x, y: 0.1, w: 0.2, h: 0.1, label });

test("image occlusion: one card per box, sharing a group", async () => {
  const deckId = await makeDeck(USER_A, "Leg");
  const res = await api(`/api/decks/${deckId}/occlusions`, {
    user: USER_A, method: "POST",
    body: { imageUrl: img("leg"), boxes: [box("a", "Patella"), box("b", "", 0.5)] },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.cards.length, 2);

  const { body: cards } = await api(`/api/decks/${deckId}/cards`, { user: USER_A });
  assert.deepEqual(cards.map((c) => c.occlusion.target), ["a", "b"]);
  assert.equal(cards[0].back_text, "Patella");
  assert.equal(cards[1].back_text, null);
  assert.equal(cards[0].front_image_url, img("leg"));
  assert.equal(cards[0].occlusion.group, res.body.group);
  assert.equal(cards[1].occlusion.boxes.length, 2);
});

test("image occlusion: editing keeps strength for boxes that stay", async () => {
  const deckId = await makeDeck(USER_A, "Leg");
  const { body: made } = await api(`/api/decks/${deckId}/occlusions`, {
    user: USER_A, method: "POST",
    body: { imageUrl: img("leg"), boxes: [box("a"), box("b", "", 0.5)] },
  });
  const cardA = made.cards.find((c) => c.occlusion.target === "a");
  await api(`/api/decks/${deckId}/cards/${cardA.id}/reviews`, {
    user: USER_A, method: "POST", body: { rating: 3 },
  });

  const put = await api(`/api/decks/${deckId}/occlusions/${made.group}`, {
    user: USER_A, method: "PUT",
    body: { imageUrl: img("leg2"), boxes: [box("a", "Tibia"), box("c", "", 0.7)] },
  });
  assert.deepEqual(put.body, { kept: 1, added: 1, removed: 1 });

  const { body: cards } = await api(`/api/decks/${deckId}/cards`, { user: USER_A });
  assert.deepEqual(cards.map((c) => c.occlusion.target).sort(), ["a", "c"]);
  const a = cards.find((c) => c.occlusion.target === "a");
  assert.equal(a.id, cardA.id);
  assert.ok(a.strength > 0.5, "box a kept its strength");
  assert.equal(a.back_text, "Tibia");
  assert.equal(a.front_image_url, img("leg2"));
  assert.ok(cards.every((c) => c.occlusion.boxes.length === 2));
});

test("image occlusion: ownership, validation and delete", async () => {
  const deckId = await makeDeck(USER_A, "Leg");
  const { body: made } = await api(`/api/decks/${deckId}/occlusions`, {
    user: USER_A, method: "POST", body: { imageUrl: img("leg"), boxes: [box("a")] },
  });
  const body = { imageUrl: img("leg"), boxes: [box("a")] };

  const strangerPost = await api(`/api/decks/${deckId}/occlusions`, { user: USER_B, method: "POST", body });
  assert.equal(strangerPost.status, 404);
  const strangerPut = await api(`/api/decks/${deckId}/occlusions/${made.group}`, { user: USER_B, method: "PUT", body });
  assert.equal(strangerPut.status, 404);
  const strangerDel = await api(`/api/decks/${deckId}/occlusions/${made.group}`, { user: USER_B, method: "DELETE" });
  assert.equal(strangerDel.status, 404);

  const bad = [
    { imageUrl: "https://evil.example/x.png", boxes: [box("a")] },
    { imageUrl: img("leg"), boxes: [] },
    { imageUrl: img("leg"), boxes: [box("a"), box("a")] },
    { imageUrl: img("leg"), boxes: [{ ...box("a"), x: 0.9, w: 0.5 }] },
  ];
  for (const b of bad) {
    const r = await api(`/api/decks/${deckId}/occlusions`, { user: USER_A, method: "POST", body: b });
    assert.equal(r.status, 400, JSON.stringify(b));
  }

  const del = await api(`/api/decks/${deckId}/occlusions/${made.group}`, { user: USER_A, method: "DELETE" });
  assert.equal(del.status, 204);
  const { body: cards } = await api(`/api/decks/${deckId}/cards`, { user: USER_A });
  assert.equal(cards.length, 0);
});

test("image occlusion cards survive sharing and copying", async () => {
  const deckId = await makeDeck(USER_A, "Leg");
  await api(`/api/decks/${deckId}/occlusions`, {
    user: USER_A, method: "POST", body: { imageUrl: img("leg"), boxes: [box("a", "Patella")] },
  });
  const { body: share } = await api(`/api/decks/${deckId}/share`, { user: USER_A, method: "POST" });
  const preview = await api(`/api/shared/${share.shareToken}`);
  assert.equal(preview.body.cards[0].occlusion.target, "a");
  const { body: copy } = await api(`/api/shared/${share.shareToken}/copy`, { user: USER_B, method: "POST" });
  const { body: copied } = await api(`/api/decks/${copy.id}/cards`, { user: USER_B });
  assert.equal(copied[0].occlusion.boxes[0].label, "Patella");
});
