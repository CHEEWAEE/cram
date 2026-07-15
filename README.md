# Cram

Flashcards that let you actually cram.

**Live demo:** coming soon

Cram is a flashcard web app built around one idea: the app shouldn't decide when you're done studying. Anki-style tools lock cards away once you've reviewed them, which is exactly what you don't want the night before an exam. Cram tracks how well you know each card and uses that to build smarter sessions, but never stops you from running a deck as many times as you want.

Make your decks on a desktop, where typing is fast. Study on your phone, in bed or on the train. Same account, same data, one app.

> 🚧 In development. This README describes the target for v1.

## Features

- Decks and cards with text and images on either side
- Study sessions: full deck, quick 10, or "weak cards" mode that samples the cards you keep missing
- Three-button rating (remembered / unsure / forgot). Forgotten cards come back a few cards later in the same session, so you can't finish until everything sticks
- Per-card strength score that your ratings adjust over time. It powers weak-cards mode but never locks you out
- Share a deck with a link. Anyone who saves it gets their own independent copy, so they can edit or delete it without touching yours
- Email sign-in with password reset
- Installable on your phone as a PWA. Opens full screen from the home screen, no browser bar

## Why it works this way

**No scheduling algorithm telling you what's due.** I looked at SM-2 (the algorithm classic Anki uses) and decided against it. It's built to spread reviews across days, which is great in theory and annoying in practice when you just want to hammer a deck before a test. Instead, every card has a strength value between 0 and 1. Rating a card nudges it up or down, and "weak cards" sessions sample low-strength cards more heavily. You get the benefit of the app knowing what you're bad at, without it rationing your studying.

**Sessions run entirely on the phone.** When a session starts, the cards load once. Flipping, rating, and the queue logic are all local state, and ratings sync back in the background. No network round trip between cards, so it stays fast even on train wifi.

**Sharing means copying.** A share link gives the recipient a full copy of the deck under their own account, with fresh strength values. There's no live link back to the original, which keeps the permissions story trivial: your deck is yours, their copy is theirs.

## Stack

- **Frontend:** React (Vite), deployed on Vercel
- **Backend:** Node.js + Express REST API, deployed on Render
- **Database / auth / storage:** Supabase (PostgreSQL, Supabase Auth with JWT verification in the API, Supabase Storage for card images)

```
React (Vercel) → Express API (Render) → Supabase (Postgres + Auth + Storage)
```

## Running locally

```bash
git clone https://github.com/<your-username>/cram.git
cd cram

# backend
cd server
npm install
cp .env.example .env   # add your Supabase keys
npm run dev

# frontend (new terminal)
cd client
npm install
npm run dev
```

You'll need a free Supabase project. Put its URL and keys in `server/.env` and `client/.env`.

## Roadmap

- [ ] Stats dashboard: streaks, reviews per day, first-attempt accuracy, weakest cards
- [ ] AI card generation: paste your notes, get draft flashcards
- [ ] CSV import/export (including Anki decks)
- [ ] Cloze deletion cards
- [ ] Keyboard shortcuts in study mode

## License

MIT
