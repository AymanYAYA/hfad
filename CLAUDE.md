# Hfad — project memory for Claude

Hfad ("learn by heart" in Moroccan Darija) is Ayman's flashcard app: a simple Anki with the FSRS scheduler.
Live at https://aymanyaya.github.io/hfad/ (GitHub Pages, repo AymanYAYA/hfad, branch main, published on push).

## Working with Ayman
- He does not code and does not want to. Claude does all the technical work: change, test, publish (commit and push to main).
- Explain what was done in plain French, 2–3 sentences, no jargon. He likes to understand, not to read code.
- Answer in French (tutoiement), short "funnel" answers first. Sprinkle a few English words with translations (he is learning English, B1). Correct his English when he writes in English.
- Be blunt: challenge his ideas, say when something is a bad idea.
- One thread = one improvement. For a big or irreversible change (content rewrite, data model, progress reset), propose first and wait for his "go".
- Never type his passwords or accept terms for him: he signs in himself.

## Product rules (decided, don't revisit without asking)
- Zero money: GitHub Pages hosting, Firebase Spark (free) plan. No paid services.
- Simple and elegant. No gamification: no XP, badges, levels, flames, chapters. No manual backup/export feature ("lazy users won't back up").
- Each user creates their own decks. Verbs is the starter deck on a first visit; Verbs and Phrasal verbs are also "Ready-made decks" anyone can add in one tap. Nothing else is imposed.
- Grade buttons Anki-style: Again (dark red) · Hard (light red) · Good (light green) · Easy (dark green), Easy on the right.
- Interface text in English.

## Architecture (no framework, no build step)
- `index.html` — page and all CSS (palette tokens in `:root`: bg #F4EEE3, surface #FBF8F2, ink #2A2621, accent olive #4E5D3A). Loads `decks.js`, `phrasal.js`, `app.js` (classic scripts) and `cloud.js` (ES module). Bump the `?v=` query of a file you change.
- `app.js` — everything else, in numbered sections: 1 FSRS-5 (default 19 params, 90% retention), 2 storage (`localStorage` key `dailydeck.v2`, old names kept on purpose) and 2b sync, 3 daily queue, 4 typed-answer checking, 5 screens (router: welcome, home, deck, add, bulk, browse, edit, options, study, stats, settings), PWA install.
- `cloud.js` — Firebase project `hfad-30a1c`: Google sign-in + Firestore, one document `users/{uid}`. Rules allow a user to read/write only their own doc. The config in the file is public by design.
- `decks.js` — Verbs starter deck. Rows 1–150: `[French verb, English, alts, English example]` + `VERBS_FR` (French example shown on the front). Rows 151–364: tense cards `[English sentence with ___, answer, alts, French sentence, level, "Tense", clue, why]`; the blank hides the whole verb group. Card ids come from position (`v1`…`v364`): append only, never reorder.
- `phrasal.js` — 100 phrasal verbs `[French meaning, answer, alts, English sentence with ___]`, ids `p1`…`p100`.
- `sw.js` — service worker: app files network-first (no-cache), fonts and Firebase SDK cached. **Bump `CACHE` (hfad-vN) on every release**, otherwise iPhones keep the old version.
- `manifest.webmanifest`, `icons/` — installable PWA.
- Security headers: a Content-Security-Policy `<meta>` in `index.html` and `privacy.html` (no inline scripts allowed). A new outside service (API, CDN) must be added there, or it is silently blocked.
- Text contrast: every text colour passes WCAG AA (4.5:1) on its background; `--muted` is #6B6357 for that reason. Keep it that way.

## Behaviour worth knowing
- Sync: merged card by card (sync v3). `save()` stamps `mod` on every card/deck whose content changed and records deletions in `S.gone` (kept 90 days); each sync reads the account doc, merges (latest change wins per card/deck, deletion wins over older changes, today's answers combined, today's stats recounted) and writes only if the account lacks something. Cloud data is gzip+base64 in field `z` (old plain `state` still read). A device with no progress takes the account's data; a device with progress from another Google account asks which to keep. Push debounced 1.5 s, sync on app focus, retry after 30 s on error.
- "Study 10 more new cards" adds to today's allowance; unused extra is dropped when the session ends.
- Create with AI (Add many): opens claude.ai/new?q= or chatgpt.com/?q= with a ready request on the user's own account; the pasted answer uses the `front ; back ; example` format; the request sets format and number (typed in the topic, else 20) and makes the AI ask ONE round of questions (direction, word or gap sentence, details; deck's first card offered as default) before writing the cards (" | " = line break on the front); on paste, a row whose front or back matches any card's front, first front line or back (whole deck, accents/case ignored) is skipped and named before adding (`freshRows`). No API key or connector on purpose: Ayman never wants others using his account or tokens, and Firebase Spark has no server code.
- Typed answers: one typo tolerated; contractions = full form. Tense cards (`c.strict`) never accept a wrong tense or a wrong ending (-s, -ed, -ing) as a typo.
- Content upgrades of starter cards run in `upgradeContent()` on load and after a sync pull (keeps user edits where possible).
- Safari: the answer input lives outside the 3D flip card (hit-testing bug); the hidden face has `pointer-events: none`.

## Testing
Run `node tests/smoke.js` before every release (walks every screen on an emulated iPhone, fails on page errors). For anything else, test with Playwright (preinstalled; Chromium at `/opt/pw-browsers/chromium`) on `file://…/index.html` with iPhone 13 emulation: clear localStorage, tap `#skip` on the welcome screen, exercise the change, check there are no page errors (ignore cloud.js/CORS errors on file://). Look at a screenshot for any UI change.

## Ideas not done yet (ask before starting)
- Fewer Firestore writes (one per session instead of one per card) — each sync is now 1 read + at most 1 write.
- Anki deck import; deck sharing; study time in stats; custom domain (paid, postponed).
