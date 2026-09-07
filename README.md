# Cram

Cram is a flashcard website that also installs as an app on your phone. Make a deck at your laptop, drill it anywhere.

Live at https://www.appcram.com

I'm a uni student, and I noticed the times I actually wanted to review flashcards were never the times I was sat at a desk. It was on the train, in the ten minutes before a tutorial, lying in bed. So I built something that works in those gaps.

## What it does

Decks and cards, with text or an image on either side. Study a deck and rate each card as remembered, unsure, or forgot. Anything you miss comes back a few cards later in the same session, so a session isn't over until everything has stuck.

Every card has a strength score between 0 and 1 that your ratings move up and down. It's there to work out what you're bad at, not to ration your studying. I looked at SM-2, the algorithm Anki uses, and didn't want it. It spreads reviews across days and hides cards until they're due, which is the last thing you want the night before an exam.

Sessions run on the phone. The cards load once when the session starts, then flipping, rating and the queue are all local, and ratings sync in the background. No network round trip between cards, so it holds up on train wifi.

## Stack

React and Vite on the front. Express on the back. Supabase underneath for Postgres, auth and image storage. Both halves deploy to Vercel.

Auth tokens are signed by Supabase and verified in the API against their public keys. Card images upload straight from the browser to storage using a one shot token from the API, so the file never travels through the server.

## Running it locally

You need a free Supabase project.

```bash
git clone https://github.com/<your-username>/cram.git
cd cram

# backend
cd server
npm install
npm run dev

# frontend, in another terminal
cd client
npm install
npm run dev
```

`server/.env` needs `DATABASE_URL` (the Supabase transaction pooler connection string), `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

`client/.env` needs `VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

You'll also need to create the tables. The schema isn't in this repo yet, which is the next thing I want to fix.

## Not done yet

- Sharing a deck with a link. The plan is that saving a shared deck gives you your own copy, with no live link back to the original
- Weak cards mode, and a quick ten card session. The strength scores are already being tracked, nothing reads them back yet
- The database schema, as above
