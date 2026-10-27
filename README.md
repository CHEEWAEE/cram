# Cram

Flashcards that install as an app on your phone. Live at https://www.appcram.com

- Text or an image on each side of a card. Paste images in with Ctrl+V, or import a whole list (Quizlet and Anki exports work)
- Image boxes: cover parts of a diagram and recall what's underneath, one card per box
- Rate each card by swiping, tapping, or pressing 1 2 3. Missed cards come back until they stick
- Weak cards, Quick 10 and back-to-front study modes
- Folders to group decks by subject
- Works offline. Decks you've opened are saved on the device and ratings sync later
- Share a deck with a link; saving it makes your own copy

## Stack

React + Vite, Express, Supabase (Postgres, auth, storage), deployed on Vercel.

## Run locally

```bash
cd server && npm install && npm run dev    # API on :3001
cd client && npm install && npm run dev    # app on :5173
```

`server/.env`: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally `ALLOWED_ORIGINS` (comma-separated; defaults to appcram.com and localhost:5173).
`client/.env`: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

Set up the database with `server/schema.sql`. Auth email templates are in `supabase/email-templates/`.

## Tests

```bash
cd server && npm test    # API against an in-memory Postgres
cd client && npm test    # import parser
```
