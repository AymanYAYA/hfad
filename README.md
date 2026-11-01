# Hfad

*Hfad* (حفظ) means "learn by heart" in Moroccan Arabic, like *anki* in Japanese.

A simple Anki: create your own decks and cards, and review them with the same scheduler as modern Anki (FSRS). Built for learning English, usable for anything.

**Try it:** https://aymanyaya.github.io/hfad/

## Problem
Anki is the reference for spaced repetition, but it is powerful and austere: many people give up on the interface before the method works. I wanted the same engine with a much simpler experience, and an option Anki doesn't make easy: typing the answer and having it checked.

## Method
**Your decks, your cards.** Create a deck, add cards one by one (front, back, optional example) or many at once by pasting `front ; back` lines or two columns from a spreadsheet. Each card can also create its reversed card. Browse, search, edit or delete any card without losing its progress.

**Two answer modes per deck.**
- *Flip the card*: think of the answer, tap the card, it turns over in 3D, then grade yourself, like Anki.
- *Type the answer*: the app checks it (one typo tolerated, several right answers allowed with `/`), offers a hint (first letter of each word) and suggests a grade.

**FSRS scheduler (FSRS-5, default parameters).** Each card has a *stability* (how many days until the chance of remembering it drops to 90%) and a *difficulty*. After each answer (Again / Hard / Good / Easy) both are updated and the next review is set when recall should still be about 90%. Again brings the card back a few cards later in the same session. Example with Good every time: 3, 11, 35, 101 days.

**Statistics.** A Stats tab shows a calendar of the days you studied (last 18 weeks) with your streak, the cards coming back in the next 7 and 30 days, the share of reviewed cards you remembered over 30 days compared with FSRS's 90% target (with advice on your pace), and how mature each deck is. A one-line summary per day is synced with the account, so statistics match on every device.

**Daily limits per deck**: new cards per day and maximum reviews per day, so missed days never turn into a mountain.

**Sync across devices.** Sign in with Google and your decks and progress are saved in your account (Firebase Authentication + Cloud Firestore), so phone and computer stay in step. Devices are merged card by card: for each card the latest change wins and deletions are remembered, so studying offline on two devices loses nothing. The saved data is compressed, so tens of thousands of cards fit. Firestore security rules let each user read and write only their own document. Without signing in, everything stays on the device.

## Result
An installable web app (PWA) for phone or desktop: add it to the home screen, it opens full screen with its own icon and works offline; no app store, account optional. It includes decks, cards, bulk add, browse and edit, 3D flip study, typed answers with checking, FSRS scheduling, daily limits and Google sign-in with sync. A starter deck of 364 English verb cards is included (150 verbs with a French example, then 214 tense cards where you choose the tense from the French sentence, with a one-line reason on the back) and can be edited or deleted; ready-made decks (Verbs, 100 Phrasal verbs) can be added in one tap from the home screen.

## Tech
No framework: `index.html` (page and styles), `manifest.webmanifest` and `sw.js` (installable app and offline mode), `app.js` (FSRS scheduler, storage, sync logic, screens), `cloud.js` (Firebase sign-in and Firestore), `decks.js` (starter deck). Data lives in `localStorage` and, once signed in, in Firestore. Built with Claude.
