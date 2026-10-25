# Cram

Cram is a flashcard website that also installs as an app on your phone. Make a deck at your laptop, drill it anywhere.

Live at https://www.appcram.com

I'm a uni student, and I noticed the times I actually wanted to review flashcards were never the times I was sat at a desk. It was on the train, in the ten minutes before a tutorial, lying in bed. So I built something that works in those gaps.

## What it does

Decks and cards, with text or an image on either side. Study a deck and rate each card as remembered, unsure, or forgot, either with the buttons, by swiping the card (right, up, left), or with 1, 2, 3 on a keyboard. Anything you miss comes back a few cards later in the same session, so a session isn't over until everything has stuck. At the end you get the split of ratings, the cards that took the most goes, and a one-tap rerun of just the ones you missed.

Every card has a strength score between 0 and 1 that your ratings move up and down. It's there to work out what you're bad at, not to ration your studying. Weak cards mode drills the twenty weakest cards in a deck, and Quick 10 pulls a random ten when you only have a few minutes. I looked at SM-2, the algorithm Anki uses, and didn't want it. It spreads reviews across days and hides cards until they're due, which is the last thing you want the night before an exam.

Sessions run on the phone. The cards load once when the session starts, then flipping, rating and the queue are all local. Ratings go into an outbox in localStorage and sync in the background, retrying if the connection drops, so nothing waits on the network between cards and a rating made in a tunnel still lands later.

Decks can be shared with a link. Saving a shared deck gives you your own copy, with no live link back to the original, and the owner can turn the link off at any time.

## Stack

React and Vite on the front. Express on the back. Supabase underneath for Postgres, auth and image storage. Both halves deploy to Vercel.

Auth tokens are signed by Supabase and verified in the API against their public keys. Card images upload straight from the browser to storage using a one shot token from the API, so the file never travels through the server.

## Running it locally

You need a free Supabase project.

```bash
git clone https://github.com/CHEEWAEE/cram.git
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

Create the tables by running `server/schema.sql` in the Supabase SQL editor. On a database that predates share links, run `server/migrations/001_deck_share_token.sql` instead.
