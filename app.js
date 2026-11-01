// Hfad – a simple Anki: your own decks and cards, scheduled with FSRS.
// Files: index.html (page and styles), app.js (this file: scheduler, storage, screens), decks.js (starter verbs deck).

// ============================================================================
// 1. FSRS-5 scheduler (the algorithm Anki uses since 23.10), default parameters.
//    Each card has a stability S (days until recall drops to 90%) and a difficulty D (1–10).
//    Grades: 1 Again · 2 Hard · 3 Good · 4 Easy.
// ============================================================================
const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const F = 19 / 81, C = -0.5;
const RETENTION = 0.9;            // aim: 90% chance you still remember a card when it comes back
const MAX_IVL = 36500;
const DAY = 86400000;
const clampD = d => Math.min(10, Math.max(1, d));
const retrievability = (t, s) => Math.pow(1 + F * t / s, C);                     // chance of recall after t days
const ivlFor = s => Math.min(MAX_IVL, Math.max(1, Math.round(s / F * (Math.pow(RETENTION, 1 / C) - 1))));
const initD = g => clampD(W[4] - Math.exp(W[5] * (g - 1)) + 1);
const nextD = (d, g) => clampD(W[7] * initD(4) + (1 - W[7]) * (d - W[6] * (g - 3) * (10 - d) / 9));
const successS = (d, s, r, g) => s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * (g === 2 ? W[15] : 1) * (g === 4 ? W[16] : 1));
const lapseS = (d, s, r) => Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
const sameDayS = (s, g) => s * Math.exp(W[17] * (g - 3 + W[18]));                  // reviewed again the same day

// What each of the four buttons would do to this card. Intervals are kept in order: Hard ≤ Good < Easy.
function outcomes(c, now = Date.now()) {
  const out = {};
  for (const g of [1, 2, 3, 4]) {
    let s, d;
    if (c.state === "new") { s = W[g - 1]; d = initD(g); }
    else {
      const t = Math.max(0, Math.round((dayStart(now) - dayStart(c.last)) / DAY));
      if (t < 1) s = sameDayS(c.stab, g);
      else { const r = retrievability(t, c.stab); s = g === 1 ? lapseS(c.diff, c.stab, r) : successS(c.diff, c.stab, r, g); }
      d = nextD(c.diff, g);
    }
    out[g] = { stab: Math.max(0.01, s), diff: d, ivl: g === 1 ? 0 : ivlFor(s) };
  }
  out[3].ivl = Math.max(out[3].ivl, out[2].ivl);
  out[4].ivl = Math.max(out[4].ivl, out[3].ivl + 1);
  return out;
}
const fmtIvl = d => d === 0 ? "now" : d < 30 ? d + "d" : d < 365 ? Math.round(d / 30) + "mo" : (d / 365).toFixed(1) + "y";

// ============================================================================
// 2. Storage. Everything lives in this browser (localStorage); once signed in, also in the cloud (section 2b).
// ============================================================================
const KEY = "dailydeck.v2", OLD_KEY = "dailydeck.v1"; // storage keys keep the old name so existing progress is not lost
let S;
function dayStart(t = Date.now()) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function dayKey(t = Date.now()) { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const defaultOpts = () => ({ newPerDay: 10, maxReviews: 200, mode: "flip" });
function newCard(deck, front, back, extra = "", alts = [], order = 0) {
  return { id: uid(), deck, front, back, extra, alts, order: order || Date.now(), state: "new", due: 0, stab: 0, diff: 0, reps: 0, lapses: 0, last: 0 };
}
// Front, back, example and accepted answers of a starter verb card.
// Tense cards: French sentence, then the English one where the blank hides the whole verb group, so you pick the tense yourself.
function verbContent(d, i) {
  if (d[5] === "Tense") return [d[3] + "\n\n" + d[0] + "   (" + d[6] + ")", d[1], d[0].replace("___", d[1]) + "\n" + d[7], d[2] || []];
  return [d[0] + (VERBS_FR[i] ? "\n\n" + VERBS_FR[i] : ""), d[1], d[3], d[2] || []];
}
// Starter deck built from decks.js (the verbs), so a first visit has something to try.
function starterCards(deckId) {
  return VERBS.map((d, i) => {
    const c = newCard(deckId, ...verbContent(d, i), i + 1);
    c.id = "v" + (i + 1); if (d[5] === "Tense") c.strict = true;
    return c;
  });
}
function phrasalCards(deckId) {
  return PHRASAL.map((r, i) => { const c = newCard(deckId, r[0] + "\n\n" + r[3], r[1], r[3].replace("___", r[1]), r[2] || [], i + 1); c.id = "p" + (i + 1); return c; });
}
// Ready-made decks anyone can add in one tap (nothing is imposed except Verbs on a first visit).
const LIBRARY = [
  { id: "verbs", name: "Verbs", desc: "364 cards: common English verbs, their irregular forms, then fill-in sentences.", cards: starterCards },
  { id: "phrasal", name: "Phrasal verbs", desc: "100 cards: the most useful phrasal verbs (give up, figure out, follow up…), French meaning → English, in a sentence.", cards: phrasalCards }
];
function addLibraryDeck(id) {
  const L = LIBRARY.find(x => x.id === id); if (!L || S.decks.some(d => d.id === id)) return;
  S.cards = S.cards.filter(c => c.deck !== id).concat(L.cards(id));
  S.decks.push({ id, name: L.name, opts: { ...defaultOpts(), mode: "type" } }); save();
}
function freshState() {
  const deck = { id: "verbs", name: "Verbs", opts: { ...defaultOpts(), mode: "type" } };
  return { v: 2, decks: [deck], cards: starterCards(deck.id), log: [], intro: {}, tenseV: 1 };
}
// Older version of the app (one built-in verbs deck, SM-2): keep the verb progress.
function migrateV1(old) {
  const st = freshState();
  const prev = new Map((old.cards || []).map(c => [c.id, c]));
  st.cards.forEach(c => {
    const o = prev.get(c.id), p = o && o.p;
    if (!p || !p.introduced) return;
    c.state = "review"; c.stab = Math.max(0.5, p.interval || 1); c.diff = clampD(initD(3) + (p.lapses || 0) * 0.5);
    c.due = p.due || dayStart(); c.last = c.due - (p.interval || 1) * DAY; c.reps = p.reps || 1; c.lapses = p.lapses || 0;
  });
  return st;
}
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) S = JSON.parse(raw); } catch (e) {}
  if (!S || !Array.isArray(S.decks)) {
    let old = null;
    try { const raw = localStorage.getItem(OLD_KEY); if (raw) old = JSON.parse(raw); } catch (e) {}
    S = old && Array.isArray(old.cards) ? migrateV1(old) : freshState();
    save();
  }
  S.log = S.log || []; S.intro = S.intro || {};
  if (!S.daily) { S.daily = {}; S.log.forEach(l => bumpDaily(l.t, l.g, l.was)); } // first time: rebuild from the history kept here
  if (!S.since) { S.since = Date.now(); save(); } // when this browser started keeping your progress
  // Ask the browser to keep this data instead of clearing it when space runs low.
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  S.decks.forEach(d => { d.opts = { ...defaultOpts(), ...(d.opts || {}) }; });
  snapshot(); // from here on, save() notices which cards and decks change
  trimExtras();
  if (upgradeContent()) save();
}
// Starter verb cards saved by an older version get the new content.
// Level 1: the French example is added (unless you edited the card). Levels 2–3 were rewritten as tense cards: new content, progress reset.
function upgradeContent() {
  let changed = false;
  S.cards.forEach(c => { const m = /^v(\d+)$/.exec(c.id), i = m ? +m[1] - 1 : -1;
    if (i >= 0 && i < VERBS_FR.length && c.front === VERBS[i][0]) c.front += "\n\n" + VERBS_FR[i];
    if (!S.tenseV && i >= VERBS_FR.length && i < VERBS.length) {
      [c.front, c.back, c.extra, c.alts] = verbContent(VERBS[i], i); c.strict = true;
      Object.assign(c, { state: "new", due: 0, stab: 0, diff: 0, reps: 0, lapses: 0, last: 0 }); changed = true;
    } });
  if (!S.tenseV) { S.tenseV = 1; changed = true; }
  return changed;
}
// Every change: keep it in this browser, then send it to the cloud a moment later if signed in.
function save() { S.updated = Date.now(); stamp(); saveLocal(); schedulePush(); }
function saveLocal() {
  const limit = Date.now() - 180 * DAY; // keep the history small (about 5 MB per site in browsers)
  if (S.log.length && S.log[0].t < limit) S.log = S.log.filter(l => l.t >= limit);
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast("Could not save: storage is full or blocked."); }
}
// Change tracking, so two devices can be merged card by card instead of one replacing the other.
// Each card and deck keeps the time it last changed (mod); a deleted card or deck leaves a note in S.gone for 90 days.
// No need to stamp by hand: save() compares every card and deck with how they were at the previous save.
let sigs = null;
const sigOf = x => { const { mod, ...rest } = x; return JSON.stringify(rest); };
function snapshot() { sigs = { c: new Map(S.cards.map(c => [c.id, sigOf(c)])), d: new Map(S.decks.map(d => [d.id, sigOf(d)])) }; }
function stamp() {
  if (!sigs) return snapshot();
  const now = Date.now(), gone = S.gone = S.gone || { c: {}, d: {} };
  for (const [k, list] of [["c", S.cards], ["d", S.decks]]) {
    const before = sigs[k], seen = new Set();
    list.forEach(x => { seen.add(x.id); if (before.get(x.id) !== sigOf(x)) x.mod = now; });
    before.forEach((_, id) => { if (!seen.has(id)) gone[k][id] = now; });
  }
  snapshot();
}

// ============================================================================
// 2b. Cloud sync (cloud.js): sign in with Google, your decks follow you on every device.
//     Rule: the two versions are merged card by card. For each card (and deck) the latest change wins,
//     a deletion wins over older changes, and the history of answers is combined. Nothing studied is lost,
//     even after studying offline on two devices.
//     Only exception: a device with progress made under another Google account asks which data to keep.
// ============================================================================
const DEVICE = (() => { try { let d = localStorage.getItem("dailydeck.device"); if (!d) { d = uid(); localStorage.setItem("dailydeck.device", d); } return d; } catch (e) { return "unknown"; } })();
let sync = { state: "off", pending: null, last: 0 };
const cloudOn = () => window.cloud && window.cloud.user;
const timeOf = x => x.mod || x.last || 0; // cards saved before change tracking: their last review stands in

// The saved data is compressed (gzip, about 5 times smaller) so a big collection fits in one cloud document (1 MB).
const streamTo = (data, t) => new Response(new Blob([data]).stream().pipeThrough(t));
async function encode(state) {
  const json = JSON.stringify(state);
  if (!window.CompressionStream) return { state: json };
  const bytes = new Uint8Array(await streamTo(json, new CompressionStream("gzip")).arrayBuffer());
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { z: btoa(s) };
}
async function decode(remote) {
  if (!remote.z) return JSON.parse(remote.state);
  const bin = atob(remote.z), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(await streamTo(bytes, new DecompressionStream("gzip")).text());
}
async function payload() {
  const { log, syncedTo, ...rest } = S, t0 = dayStart();
  return { v: 3, updated: S.updated || Date.now(), device: DEVICE, ...(await encode({ ...rest, log: log.filter(l => l.t >= t0) })) };
}

// Merge this device (L) with the account (R). Tells whether this device and the account each need the result.
function mergeStates(L, R) {
  let toLocal = false, toCloud = false;
  const cutoff = Date.now() - 90 * DAY;
  const gone = { c: {}, d: {} };
  for (const k of ["c", "d"]) {
    const a = (L.gone && L.gone[k]) || {}, b = (R.gone && R.gone[k]) || {};
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const t = Math.max(a[id] || 0, b[id] || 0); if (t < cutoff) continue;
      gone[k][id] = t; if ((a[id] || 0) < t) toLocal = true; if ((b[id] || 0) < t) toCloud = true;
    }
  }
  const mergeList = (mine = [], theirs = [], k) => {
    const rById = new Map(theirs.map(x => [x.id, x])), out = [];
    const take = (l, r) => {
      const w = !l ? r : !r ? l : timeOf(r) > timeOf(l) ? r : l; // same time: keep this device's version
      const g = gone[k][w.id];
      if (g && g >= timeOf(w)) { if (l) toLocal = true; if (r) toCloud = true; return; } // deleted after its last change
      if (g) delete gone[k][w.id]; // brought back after the deletion (e.g. a ready-made deck added again)
      if (w !== l && (!l || sigOf(w) !== sigOf(l) || w.mod !== l.mod)) toLocal = true;
      if (w !== r && (!r || sigOf(w) !== sigOf(r) || w.mod !== r.mod)) toCloud = true;
      out.push(w);
    };
    mine.forEach(l => { take(l, rById.get(l.id)); rById.delete(l.id); });
    rById.forEach(r => take(null, r));
    return out;
  };
  const decks = mergeList(L.decks, R.decks, "d"), cards = mergeList(L.cards, R.cards, "c");
  const maxMap = (a = {}, b = {}) => {
    const out = { ...a };
    for (const k in b) { if ((out[k] || 0) < b[k]) { out[k] = b[k]; toLocal = true; } else if (out[k] > b[k]) toCloud = true; }
    for (const k in a) if (!(k in b)) toCloud = true;
    return out;
  };
  const intro = maxMap(L.intro, R.intro), extraNew = maxMap(L.extraNew, R.extraNew);
  // history: this device's own, plus today's answers from the account (the cloud keeps only today's)
  const t0 = dayStart(), seen = new Set(), key = l => l.t + "|" + l.card;
  const rKeys = new Set((R.log || []).map(key));
  const log = [...(L.log || []), ...(R.log || [])].filter(l => { const k = key(l); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.t - b.t);
  if (log.length > (L.log || []).length) toLocal = true;
  if (log.some(l => l.t >= t0 && !rKeys.has(key(l)))) toCloud = true;
  // statistics: past days take the larger count; today is recounted from today's combined answers
  const daily = mergeDaily(L.daily, R.daily), today = dayKey();
  const S0 = S; S = { daily: {} }; log.filter(l => l.t >= t0).forEach(l => bumpDaily(l.t, l.g, l.was));
  if (S.daily[today]) daily[today] = S.daily[today]; S = S0;
  return {
    state: { ...R, ...L, decks, cards, gone, intro, extraNew, log, daily, tenseV: Math.max(L.tenseV || 0, R.tenseV || 0) || undefined, updated: Math.max(L.updated || 0, R.updated || 0) },
    toLocal, toCloud
  };
}
// Replace this device's data with the account's (a device with no progress yet, or by choice).
function takeRemote(r) {
  S = { ...r, log: [...S.log.filter(l => l.t < dayStart()), ...(r.log || [])], daily: mergeDaily(S.daily, r.daily), since: S.since, syncedTo: window.cloud.user.uid };
  afterRemote();
}
function afterRemote() {
  S.intro = S.intro || {}; S.decks.forEach(d => { d.opts = { ...defaultOpts(), ...(d.opts || {}) }; });
  snapshot();
  if (upgradeContent()) save();
  saveLocal();
  if (view.name !== "study") render();
}

let pushTimer, busy = false, again = false, retryTimer;
function schedulePush() { if (!cloudOn() || S.syncedTo !== window.cloud.user.uid) return; clearTimeout(pushTimer); pushTimer = setTimeout(syncNow, 1500); }
// One sync: read the account, merge, write back only if the account is missing something.
async function syncNow() {
  if (!cloudOn()) return;
  if (busy) { again = true; return; }
  busy = true; sync.state = "syncing"; syncBadge();
  const me = window.cloud.user.uid;
  try {
    const remote = await window.cloud.pull();
    if (!remote) { await window.cloud.push(await payload()); S.syncedTo = me; saveLocal(); }  // first device: the cloud starts from here
    else {
      const R = await decode(remote);
      const studied = S.cards.some(c => c.state !== "new");
      if (S.syncedTo !== me && !studied) takeRemote(R);                                         // nothing here yet: take the account's data
      else if (S.syncedTo && S.syncedTo !== me) { sync.pending = { r: R, updated: remote.updated }; sync.state = "choice"; } // progress from another account
      else {
        const m = mergeStates(S, R);
        if (m.toLocal) { S = m.state; S.syncedTo = me; afterRemote(); }
        else if (S.syncedTo !== me) { S.syncedTo = me; saveLocal(); }
        if (m.toCloud) await window.cloud.push(await payload());
      }
    }
    if (sync.state !== "choice") { sync.state = "ok"; sync.last = Date.now(); }
  } catch (e) {
    sync.state = "error"; clearTimeout(retryTimer); retryTimer = setTimeout(syncNow, 30000);
  }
  busy = false; syncBadge();
  if (sync.state === "choice" && view.name !== "study" && view.name !== "settings") go({ name: "settings" });
  if (again) { again = false; syncNow(); }
}
function syncBadge() { const b = document.getElementById("syncBadge"); if (b) b.innerHTML = syncText(); }
function syncText() {
  if (!window.cloud) return `<span class="muted">Sync loading…</span>`;
  if (!window.cloud.user) return `<button class="link" data-go-settings>☁ Sign in to sync your devices</button>`;
  return { off: "☁ Signed in", syncing: "☁ Syncing…", ok: "☁ Synced", error: "☁ Sync failed, retrying soon", choice: "☁ Choose which data to keep (Settings)" }[sync.state] || "☁";
}
window.addEventListener("cloud-ready", () => { syncBadge(); if (view.name === "settings" || view.name === "welcome") render(); });
window.addEventListener("cloud-auth", () => {
  if (cloudOn() && view.name === "welcome") { S.welcomed = true; saveLocal(); document.querySelector("nav.tabs").hidden = false; view = { name: "home" }; render(); }
  if (cloudOn()) syncNow(); else { sync.state = "off"; }
  syncBadge(); if (view.name === "settings") render();
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && cloudOn() && view.name !== "study") syncNow(); });
document.addEventListener("click", e => { if (e.target.closest("[data-go-settings]")) go({ name: "settings" }); });

// ============================================================================
// 3. Daily queue per deck: learning cards first, then reviews mixed with new cards.
// ============================================================================
const deckById = id => S.decks.find(d => d.id === id);
const cardById = id => S.cards.find(c => c.id === id);
const cardsOf = id => S.cards.filter(c => c.deck === id);
const introKey = id => id + "|" + dayKey();
function reviewsToday(id) { const s = dayStart(); return S.log.filter(l => l.t >= s && l.deck === id && l.was !== "new").length; }
// "Study 10 more new cards" adds to today's allowance; it can be pressed as many times as you like.
// When a session ends, extra new cards you didn't use are dropped, so "New" never shows leftovers as homework.
function trimExtras() {
  if (!S.extraNew) return; const today = dayKey();
  for (const k in S.extraNew) {
    const [id, day] = k.split("|"), d = deckById(id);
    const used = d && day === today ? (S.intro[k] || 0) - d.opts.newPerDay : 0;
    if (used > 0) S.extraNew[k] = used; else delete S.extraNew[k];
  }
}
const extraToday = id => (S.extraNew && S.extraNew[introKey(id)]) || 0;
function counts(deck) {
  const end = dayStart() + DAY, cs = cardsOf(deck.id);
  const learning = cs.filter(c => c.state === "learning" && c.due < end).sort((a, b) => a.due - b.due);
  const due = cs.filter(c => c.state === "review" && c.due < end).sort((a, b) => a.due - b.due)
    .slice(0, Math.max(0, deck.opts.maxReviews - reviewsToday(deck.id)));
  const fresh = cs.filter(c => c.state === "new").sort((a, b) => a.order - b.order)
    .slice(0, Math.max(0, deck.opts.newPerDay + extraToday(deck.id) - (S.intro[introKey(deck.id)] || 0)));
  return { learning, due, fresh, newLeft: cs.filter(c => c.state === "new").length };
}
function buildQueue(deck) {
  const { learning, due, fresh } = counts(deck);
  const mixed = [], every = fresh.length ? Math.max(1, Math.floor(due.length / fresh.length)) : 0;
  let n = 0;
  due.forEach((c, i) => { mixed.push(c); if (every && (i + 1) % every === 0 && n < fresh.length) mixed.push(fresh[n++]); });
  while (n < fresh.length) mixed.push(fresh[n++]);
  return [...learning, ...mixed].map(c => c.id);
}
function answer(c, g) {
  const o = outcomes(c)[g], now = Date.now(), was = c.state;
  if (was === "new") S.intro[introKey(c.deck)] = (S.intro[introKey(c.deck)] || 0) + 1;
  c.stab = o.stab; c.diff = o.diff; c.last = now; c.reps++;
  if (g === 1) { if (was === "review") c.lapses++; c.state = "learning"; c.due = now; } // comes back a few cards later
  else { c.state = "review"; c.due = dayStart(now) + o.ivl * DAY; }
  S.log.push({ t: now, card: c.id, deck: c.deck, g, was });
  bumpDaily(now, g, was);
  save();
}
// One small summary per day, synced with the account, so statistics are the same on every device.
// n = cards answered, nw = new cards, rev = review cards, ok = review cards remembered (Hard, Good or Easy)
function bumpDaily(t, g, was) {
  S.daily = S.daily || {};
  const d = S.daily[dayKey(t)] || (S.daily[dayKey(t)] = { n: 0, nw: 0, rev: 0, ok: 0 });
  d.n++; if (was === "new") d.nw++; else if (was === "review") { d.rev++; if (g > 1) d.ok++; }
}
function mergeDaily(a = {}, b = {}) {
  const out = {};
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => {
    const x = a[k] || {}, y = b[k] || {};
    out[k] = { n: Math.max(x.n || 0, y.n || 0), nw: Math.max(x.nw || 0, y.nw || 0), rev: Math.max(x.rev || 0, y.rev || 0), ok: Math.max(x.ok || 0, y.ok || 0) };
  });
  return out;
}

// ============================================================================
// 4. Typed answers: compare with the back of the card, tolerate one typo.
// ============================================================================
// Contractions count as the full form: "haven't" = "have not", "I'll" = "I will".
const expand = t => String(t ?? "").toLowerCase().replace(/[’‘]/g, "'").replace(/\bwon'?t\b/g, "will not").replace(/\bcan'?t\b|\bcan not\b/g, "cannot").replace(/\bshan'?t\b/g, "shall not")
  .replace(/\b(do|does|did|have|has|had|is|are|was|were|could|would|should|must|need)n'?t\b/g, "$1 not").replace(/'ve\b/g, " have").replace(/'ll\b/g, " will").replace(/'re\b/g, " are").replace(/\bi'm\b/g, "i am");
const norm = t => expand(t).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’‘]/g, "").replace(/…/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const core = t => norm(t).replace(/^(to|a|an|the) /, "");
const accepted = c => [...String(c.back).split(/\s*[\/;\n]\s*/), ...(c.alts || [])].map(core).filter(Boolean);
function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } }
  return d[b.length];
}
const grammarEnding = (a, b) => { const [s, l] = a.length < b.length ? [a, b] : [b, a]; return s !== l && l.startsWith(s) && /^(s|es|d|ed|ing)$/.test(l.slice(s.length)); };
function check(typed, c) {
  const a = core(typed), acc = accepted(c);
  if (!a) return "wrong";
  if (acc.includes(a)) return "exact";
  // Tense cards: a typo is fine, a wrong tense is not. Same number of words, the first word exact, at most one letter off per word.
  if (c.strict) return acc.some(e => { const x = a.split(" "), y = e.split(" "); if (x.length !== y.length || x[0] !== y[0] && y.length > 1) return false;
    if (x.some((w, k) => grammarEnding(w, y[k]))) return false; // "rain" for "rains": a grammar mistake, not a typo
    const ds = x.map((w, k) => lev(w, y[k])); return ds.every(d => d <= 1) && ds.reduce((p, q) => p + q, 0) <= (y.length > 1 ? 2 : 1) && e.length >= 4; }) ? "almost" : "wrong";
  return acc.some(e => { const d = lev(a, e); return (d === 1 && e.length >= 4) || 1 - d / Math.max(a.length, e.length) >= 0.8; }) ? "almost" : "wrong";
}
const markMissing = (typed, expected) => { const got = new Set(norm(typed).split(" ")); return expected.split(/(\s+)/).map(w => /^\s+$/.test(w) || !norm(w) || got.has(norm(w)) ? esc(w) : `<mark>${esc(w)}</mark>`).join(""); };
const hintOf = t => String(t).split(" ").map(w => w.replace(/(^[^\p{L}]*\p{L})|\p{L}/gu, (m, first) => first || "_")).join("  ");

// ============================================================================
// 5. Screens
// ============================================================================
const $ = s => document.querySelector(s);
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
let view = { name: "home" }, ses = null;
let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1800); }
function go(v) { if (view.name === "study" && v.name !== "study") { trimExtras(); saveLocal(); } view = v; render(); window.scrollTo(0, 0); }
// "Tap again to confirm" instead of a browser pop-up
function armed(btn, label, action) {
  btn.onclick = () => {
    if (btn.classList.contains("armed")) return action();
    btn.classList.add("armed"); const old = btn.textContent; btn.textContent = label;
    setTimeout(() => { btn.classList.remove("armed"); btn.textContent = old; }, 3000);
  };
}
const header = (title, backTo) => `<div class="top">${backTo ? `<button class="back-btn" id="back" aria-label="Back">‹</button>` : ""}<h1>${esc(title)}</h1></div>`;
const wireBack = to => { const b = $("#back"); if (b) b.onclick = () => go(to); };
function nums(n, d) { return `<span class="nums"><span class="${n ? "n-new" : "n-zero"}" title="New">${n}</span><span class="${d ? "n-due" : "n-zero"}" title="To review">${d}</span></span>`; }

function render() {
  document.querySelectorAll("[data-tab]").forEach(b => b.dataset.tab === (["settings", "stats"].includes(view.name) ? view.name : "decks") ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  ({ welcome, stats, home, deck: deckScreen, add, bulk, browse, edit, options, study, settings })[view.name]();
}

// --- Statistics: regularity, what's coming, how well you remember, how mature your decks are
function stats() {
  const daily = S.daily || {}, today = dayStart();
  const did = k => daily[k] && daily[k].n > 0;
  // streak (today counts once you've studied; yesterday keeps it alive until then)
  let streak = 0, t = did(dayKey(today)) ? today : today - DAY;
  while (did(dayKey(t))) { streak++; t -= DAY; }
  let best = 0, run = 0, prev = null;
  Object.keys(daily).filter(did).sort().forEach(k => { const d = new Date(k + "T12:00:00").getTime(); run = prev !== null && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; });
  const total = Object.values(daily).reduce((n, d) => n + d.n, 0), daysOn = Object.keys(daily).filter(did).length;

  // calendar: the last 18 weeks, one square per day, Monday first
  const WEEKS = 18, start = new Date(today); start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  const level = n => !n ? 0 : n < 10 ? 1 : n < 30 ? 2 : n < 60 ? 3 : 4;
  let cells = "";
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = dayKey(d.getTime()), n = (daily[k] && daily[k].n) || 0, future = d.getTime() > today;
    const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    cells += future ? `<i class="cell future"></i>` : `<i class="cell l${level(n)}${d.getTime() === today ? " today" : ""}" data-tip="${label}: ${n} card${n === 1 ? "" : "s"}" title="${label}: ${n}"></i>`;
  }

  // forecast: cards coming back in the next 7 days (anything overdue counts for today)
  const fc = Array(7).fill(0);
  S.cards.forEach(c => { if (c.state === "new") return; const i = Math.max(0, Math.round((dayStart(c.due) - today) / DAY)); if (i < 7) fc[i]++; });
  const month = S.cards.filter(c => c.state !== "new" && dayStart(c.due) - today < 30 * DAY).length;
  const fmax = Math.max(1, ...fc);
  const bars = fc.map((n, i) => { const d = new Date(today + i * DAY), lab = i === 0 ? "Today" : i === 1 ? "Tmrw" : d.toLocaleDateString("en-GB", { weekday: "short" });
    return `<div class="fbar" data-tip="${i === 0 ? "Today" : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}: ${n} card${n === 1 ? "" : "s"}"><span class="fval">${n || ""}</span><i style="height:${n ? Math.max(4, 100 * n / fmax) : 0}%"></i><span class="flab">${lab}</span></div>`; }).join("");

  // retention: reviews of the last 30 days that you remembered
  let rev = 0, ok = 0;
  for (let i = 0; i < 30; i++) { const d = daily[dayKey(today - i * DAY)]; if (d) { rev += d.rev; ok += d.ok; } }
  const pct = rev ? Math.round(100 * ok / rev) : null;
  const advice = pct === null ? "Not enough reviews yet. It shows up once cards start coming back."
    : pct < 80 ? "Below the 90% target: you may be adding new cards faster than you can keep them. Try fewer new cards per day."
    : pct > 95 ? "Above the 90% target: your cards are easy for you. You can add more new cards per day."
    : "Right on target: the pace suits you.";

  // maturity per deck
  const rows = S.decks.map(d => {
    const cs = cardsOf(d.id), nNew = cs.filter(c => c.state === "new").length, mature = cs.filter(c => c.state === "review" && ivlOf(c) >= 21).length, learning = cs.length - nNew - mature;
    const seg = (n, cls, name) => n ? `<i class="${cls}" style="flex:${n}" data-tip="${esc(d.name)}: ${n} ${name}"></i>` : "";
    return `<div class="mat"><div class="goal-top"><b>${esc(d.name)}</b><span class="muted small-text">${nNew} new · ${learning} learning · ${mature} mature</span></div>
      <div class="matbar">${cs.length ? seg(nNew, "m-new", "new") + seg(learning, "m-learn", "learning") + seg(mature, "m-mature", "mature") : '<i class="m-empty" style="flex:1"></i>'}</div></div>`;
  }).join("");

  app.innerHTML = `${header("Stats")}
    <div class="panel">
      <div class="tiles3"><div><b>${streak}</b><span>day streak</span></div><div><b>${best}</b><span>best streak</span></div><div><b>${total}</b><span>cards answered</span></div></div>
      <div class="heat" aria-label="Days you studied, last 18 weeks">${cells}</div>
      <div class="heat-legend small-text muted"><span>${daysOn} day${daysOn === 1 ? "" : "s"} studied</span><span>Less <i class="cell l0"></i><i class="cell l1"></i><i class="cell l2"></i><i class="cell l3"></i><i class="cell l4"></i> More</span></div>
    </div>
    <div class="panel">
      <h2>Coming up</h2>
      <div class="forecast">${bars}</div>
      <p class="muted small-text" style="margin:0">${month} card${month === 1 ? "" : "s"} to review in the next 30 days.</p>
    </div>
    <div class="panel">
      <h2>Remembered</h2>
      <div class="hero"><b>${pct === null ? "–" : pct + "%"}</b><span class="muted small-text">of the cards you reviewed in the last 30 days (${ok} / ${rev}). Target: about 90%.</span></div>
      <p style="margin:0" class="small-text">${advice}</p>
    </div>
    <div class="panel">
      <h2>Decks</h2>
      <div class="row small-text muted"><span><i class="key m-new"></i> New</span><span><i class="key m-learn"></i> Learning</span><span><i class="key m-mature"></i> Mature (3+ weeks)</span></div>
      ${rows || '<p class="muted" style="margin:0">No deck yet.</p>'}
    </div>`;
}

// --- First open: sign in with Google, or continue without an account
function welcome() {
  const ready = !!window.cloud;
  app.innerHTML = `<div class="welcome">
      <img src="icons/icon-192.png" alt="" width="96" height="96">
      <h1>Hfad</h1>
      <p class="tagline">Learn anything by heart, with your own cards.</p>
      <div class="panel">
        <p style="margin:0">Sign in to keep your decks and progress safe and the same on all your devices.</p>
        <button class="primary wide" id="gSign" ${ready ? "" : "disabled"}>${ready ? "Continue with Google" : "Loading…"}</button>
        <button class="link" id="skip">Use without an account</button>
        <p class="muted small-text" style="margin:0">Without an account, your cards stay on this device only. You can sign in later in Settings.</p>
      </div>
    </div>`;
  document.querySelector("nav.tabs").hidden = true;
  const done = () => { S.welcomed = true; saveLocal(); document.querySelector("nav.tabs").hidden = false; go({ name: "home" }); };
  $("#skip").onclick = done;
  $("#gSign").onclick = async () => {
    try { await window.cloud.signIn(); if (window.cloud.user) done(); }
    catch (e) { toast("Sign-in failed: " + (e.code || "try again") + ". You can also sign in later in Settings."); }
  };
}

// --- Home: your decks
function home() {
  const lib = LIBRARY.filter(L => !S.decks.some(d => d.id === L.id));
  const rows = S.decks.map(d => {
    const k = counts(d), total = cardsOf(d.id).length;
    return `<button class="deck-row" data-deck="${d.id}"><span><span class="name">${esc(d.name)}</span><br><span class="sub">${total} card${total === 1 ? "" : "s"}</span></span>${nums(k.fresh.length, k.due.length + k.learning.length)}</button>`;
  }).join("");
  app.innerHTML = `${header("Hfad")}
    <div class="small-text sync" id="syncBadge">${syncText()}</div>
    ${S.decks.length ? `<div class="row small-text muted"><span class="n-new">● New</span><span class="n-due">● To review</span></div><div class="decks">${rows}</div>`
      : `<div class="panel empty"><div class="big">No deck yet</div><p class="muted" style="margin:0">Create your first deck, then add cards to it.</p></div>`}
    <div class="panel">
      <div class="field"><label for="newDeck">New deck</label><input id="newDeck" type="text" placeholder="e.g. Phrasal verbs, Interview English…" autocomplete="off"></div>
      <button class="primary" id="createDeck">Create deck</button>
    </div>
    ${lib.length ? `<div class="panel"><h2>Ready-made decks</h2>${lib.map(L => `<div class="lib"><div><b>${esc(L.name)}</b><p class="muted small-text" style="margin:2px 0 0">${esc(L.desc)}</p></div><button data-lib="${L.id}">Add</button></div>`).join("")}</div>` : ""}`;
  document.querySelectorAll("[data-lib]").forEach(b => b.onclick = () => { addLibraryDeck(b.dataset.lib); toast("Deck added"); go({ name: "deck", deck: b.dataset.lib }); });
  document.querySelectorAll("[data-deck]").forEach(b => b.onclick = () => go({ name: "deck", deck: b.dataset.deck }));
  const create = () => {
    const name = $("#newDeck").value.trim(); if (!name) return $("#newDeck").focus();
    const d = { id: uid(), name, opts: defaultOpts() }; S.decks.push(d); save(); toast("Deck created"); go({ name: "add", deck: d.id });
  };
  $("#createDeck").onclick = create;
  $("#newDeck").onkeydown = e => { if (e.key === "Enter") create(); };
}

// --- One deck: study, add, browse, options
const ivlOf = c => c.state === "new" ? 0 : Math.max(0, Math.round((c.due - dayStart(c.last)) / DAY));
function deckScreen() {
  const d = deckById(view.deck); if (!d) return go({ name: "home" });
  const k = counts(d), cs = cardsOf(d.id), todo = k.fresh.length + k.due.length + k.learning.length;
  const young = cs.filter(c => c.state !== "new" && ivlOf(c) < 21).length, mature = cs.filter(c => c.state === "review" && ivlOf(c) >= 21).length;
  const tomorrow = cs.filter(c => c.state !== "new" && c.due < dayStart() + 2 * DAY).length;
  app.innerHTML = `${header(d.name, true)}
    <div class="panel study-box">
      <div class="study-nums"><div><b class="n-new">${k.fresh.length}</b><span class="label">New</span></div><div><b class="n-due">${k.due.length + k.learning.length}</b><span class="label">To review</span></div></div>
      ${todo ? `<button class="primary wide" id="studyBtn">Study now</button>`
        : `<p style="margin:0"><b>Done for today.</b> <span class="muted">${cs.length ? `${tomorrow} card${tomorrow === 1 ? "" : "s"} to review tomorrow.` : "Add some cards to start."}</span></p>
           ${k.newLeft ? `<button class="wide" id="moreBtn">Study 10 more new cards</button>` : ""}`}
    </div>
    <div class="menu">
      <button id="addBtn">＋ Add a card</button><button id="bulkBtn">Add many</button>
      <button id="browseBtn">Browse cards</button><button id="optBtn">Options</button>
    </div>
    <div class="panel">
      <div class="stats"><div><b>${cs.length}</b><span>Cards</span></div><div><b>${cs.length - young - mature}</b><span>New</span></div><div><b>${young}</b><span>Learning</span></div><div><b>${mature}</b><span>Mature</span></div></div>
      <p class="muted small-text" style="margin:0">Mature = the next review is 3 weeks or more away. Answer mode: <b>${d.opts.mode === "type" ? "type the answer" : "flip the card"}</b>, ${d.opts.newPerDay} new cards a day.</p>
    </div>`;
  wireBack({ name: "home" });
  const sb = $("#studyBtn"); if (sb) sb.onclick = () => startStudy(d);
  const mb = $("#moreBtn"); if (mb) mb.onclick = () => startStudy(d, 10);
  $("#addBtn").onclick = () => go({ name: "add", deck: d.id });
  $("#bulkBtn").onclick = () => go({ name: "bulk", deck: d.id });
  $("#browseBtn").onclick = () => go({ name: "browse", deck: d.id, q: "" });
  $("#optBtn").onclick = () => go({ name: "options", deck: d.id });
}

// --- Add one card
function add() {
  const d = deckById(view.deck); if (!d) return go({ name: "home" });
  app.innerHTML = `${header("Add a card", true)}
    <p class="muted small-text" style="margin:-8px 0 0">Deck: <b>${esc(d.name)}</b> · <span id="nCards">${cardsOf(d.id).length}</span> cards</p>
    <div class="panel">
      <div class="field"><label for="front">Front <span class="help">— the question</span></label><textarea id="front" placeholder="e.g. partir"></textarea></div>
      <div class="field"><label for="backF">Back <span class="help">— the answer. Several right answers? Separate them with /</span></label><textarea id="backF" placeholder="e.g. to leave"></textarea></div>
      <div class="field"><label for="extra">Example or note <span class="help">— optional, shown with the answer</span></label><textarea id="extra" placeholder="e.g. I leave work at 6."></textarea></div>
      <label class="check"><input type="checkbox" id="rev"> Also add the reversed card (back → front)</label>
      <button class="primary wide" id="saveCard">Add card</button>
    </div>`;
  wireBack({ name: "deck", deck: d.id });
  $("#front").focus();
  $("#saveCard").onclick = () => {
    const f = $("#front").value.trim(), b = $("#backF").value.trim(), x = $("#extra").value.trim();
    if (!f || !b) return toast("Fill in the front and the back.");
    S.cards.push(newCard(d.id, f, b, x));
    if ($("#rev").checked) S.cards.push(newCard(d.id, b, f, x));
    save(); toast($("#rev").checked ? "2 cards added" : "Card added");
    $("#front").value = $("#backF").value = $("#extra").value = ""; $("#front").focus();
    $("#nCards").textContent = cardsOf(d.id).length;
  };
}

// --- Add many at once: one card per line, "front ; back" (or pasted from a spreadsheet)
function parseLines(text) {
  // AI answers often come with code fences, bullets, numbers or **bold**: clean them away.
  return text.split("\n").map(l => l.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "").replace(/\*\*/g, "").trim())
    .filter(l => l && !/^```/.test(l)).map(l => {
    const parts = l.includes("\t") ? l.split("\t") : l.split(/\s*;\s*/);
    return parts.length >= 2 && parts[0] && parts[1] ? { front: parts[0].trim(), back: parts[1].trim(), extra: (parts[2] || "").trim() } : null;
  });
}
// Request for an outside AI (Claude, ChatGPT): answer comes back in the "front ; back ; example" format above.
function aiPrompt(d, topic) {
  return `Make flashcards for my flashcard app. Topic: ${topic}
My deck is called "${d.name}".

Reply with the cards only, one per line, in exactly this format:
front ; back ; example sentence

Rules:
- No title, no numbering, no bullet points, no extra text before or after.
- Never put a ";" inside a field.
- Keep the front and the back short (a word or a short phrase). The example is optional.
- Make 20 cards unless the topic says how many.`;
}
// Splits pasted rows into new cards and ones already in the deck (same front), checked against the whole deck.
function freshRows(deckId, rows) {
  const seen = new Set(cardsOf(deckId).flatMap(c => [norm(c.front), norm(c.front.split("\n")[0])])), fresh = []; let dup = 0; // starter fronts carry an example on later lines
  for (const r of rows) { const k = norm(r.front); if (k && seen.has(k)) { dup++; continue; } seen.add(k); fresh.push(r); }
  return { fresh, dup };
}
function bulk() {
  const d = deckById(view.deck); if (!d) return go({ name: "home" });
  app.innerHTML = `${header("Add many", true)}
    <div class="panel">
      <p class="label" style="margin:0">Create with AI</p>
      <p class="muted small-text" style="margin:0">Say what the cards should be about. Hfad writes the request for you: open your AI, copy its answer, come back and paste it below. Not quite right? Ask the AI to change it before you copy. Cards you already have are skipped.</p>
      <input type="text" id="aiTopic" placeholder="e.g. 20 kitchen words, French → English" autocomplete="off">
      <div class="row">
        <button class="small" id="aiClaude">Open in Claude</button>
        <button class="small" id="aiGpt">Open in ChatGPT</button>
        <button class="small link" id="aiCopy">Copy the request</button>
      </div>
      <textarea id="aiText" readonly hidden></textarea>
    </div>
    <div class="panel">
      <p style="margin:0">One card per line: <b>front ; back</b>, and optionally <b>; example</b>.</p>
      <p class="muted small-text" style="margin:0">You can also paste two columns from Excel or Google Sheets. Example:<br><code>partir ; to leave ; I leave at 6.</code><br><code>oublier ; to forget</code></p>
      <textarea id="lines" class="big" placeholder="Paste the AI’s answer here, or type:&#10;partir ; to leave&#10;oublier ; to forget"></textarea>
      <label class="check"><input type="checkbox" id="rev"> Also add the reversed cards</label>
      <p class="muted small-text" id="preview" style="margin:0">0 cards ready.</p>
      <button class="primary wide" id="addAll" disabled>Add cards</button>
    </div>`;
  wireBack({ name: "deck", deck: d.id });
  const upd = () => {
    const rows = parseLines($("#lines").value), bad = rows.filter(r => !r).length, { fresh, dup } = freshRows(d.id, rows.filter(Boolean)), ok = fresh.length;
    $("#preview").textContent = `${ok} card${ok === 1 ? "" : "s"} ready${dup ? ` · ${dup} already in this deck, skipped` : ""}${bad ? ` · ${bad} line${bad === 1 ? "" : "s"} without “ ; ” will be skipped` : ""}.`;
    $("#addAll").disabled = !ok; $("#addAll").textContent = ok ? `Add ${ok * ($("#rev").checked ? 2 : 1)} cards` : "Add cards";
  };
  $("#lines").oninput = upd; $("#rev").onchange = upd;
  const ask = how => {
    const topic = $("#aiTopic").value.trim();
    if (!topic) { toast("Say what the cards should be about"); $("#aiTopic").focus(); return; }
    const prompt = aiPrompt(d, topic);
    if (how !== "copy") return window.open((how === "claude" ? "https://claude.ai/new?q=" : "https://chatgpt.com/?q=") + encodeURIComponent(prompt), "_blank", "noopener");
    const show = () => { const t = $("#aiText"); t.hidden = false; t.value = prompt; t.select(); toast("Copy this text and paste it in your AI"); };
    navigator.clipboard ? navigator.clipboard.writeText(prompt).then(() => toast("Request copied: paste it in your AI"), show) : show();
  };
  $("#aiClaude").onclick = () => ask("claude"); $("#aiGpt").onclick = () => ask("gpt"); $("#aiCopy").onclick = () => ask("copy");
  $("#addAll").onclick = () => {
    const rows = freshRows(d.id, parseLines($("#lines").value).filter(Boolean)).fresh, base = Date.now();
    rows.forEach((r, i) => {
      S.cards.push(newCard(d.id, r.front, r.back, r.extra, [], base + i));
      if ($("#rev").checked) S.cards.push(newCard(d.id, r.back, r.front, r.extra, [], base + i + 0.5));
    });
    save(); toast(`${rows.length * ($("#rev").checked ? 2 : 1)} cards added`); go({ name: "deck", deck: d.id });
  };
}

// --- Browse and search
function statusOf(c) {
  if (c.state === "new") return "new";
  const days = Math.round((c.due - dayStart()) / DAY);
  return days <= 0 ? "due" : "in " + fmtIvl(days);
}
function browse() {
  const d = deckById(view.deck); if (!d) return go({ name: "home" });
  app.innerHTML = `${header("Browse", true)}
    <input type="search" id="q" placeholder="Search ${cardsOf(d.id).length} cards" value="${esc(view.q || "")}" autocomplete="off">
    <div class="panel" style="padding:4px 16px"><div class="list" id="list"></div></div>`;
  wireBack({ name: "deck", deck: d.id });
  const draw = () => {
    const q = norm($("#q").value);
    const items = cardsOf(d.id).filter(c => !q || norm(c.front + " " + c.back).includes(q)).sort((a, b) => a.order - b.order);
    $("#list").innerHTML = items.length ? items.slice(0, 300).map(c => `<button class="item" data-card="${c.id}"><span class="f">${esc(c.front)}</span><span class="b">${esc(c.back)}</span><span class="s">${statusOf(c)}</span></button>`).join("")
      + (items.length > 300 ? `<p class="muted small-text">Showing 300 of ${items.length}. Search to narrow down.</p>` : "")
      : `<p class="muted">No card found.</p>`;
    document.querySelectorAll("[data-card]").forEach(b => b.onclick = () => go({ name: "edit", deck: d.id, card: b.dataset.card, q: $("#q").value }));
  };
  $("#q").oninput = draw; draw();
}

// --- Edit one card
function edit() {
  const c = cardById(view.card); if (!c) return go({ name: "browse", deck: view.deck });
  app.innerHTML = `${header("Edit card", true)}
    <div class="panel">
      <div class="field"><label for="front">Front</label><textarea id="front">${esc(c.front)}</textarea></div>
      <div class="field"><label for="backF">Back</label><textarea id="backF">${esc(c.back)}</textarea></div>
      <div class="field"><label for="extra">Example or note</label><textarea id="extra">${esc(c.extra)}</textarea></div>
      <p class="muted small-text" style="margin:0">Status: ${statusOf(c)} · reviewed ${c.reps} time${c.reps === 1 ? "" : "s"} · forgotten ${c.lapses} time${c.lapses === 1 ? "" : "s"}. Editing keeps the progress.</p>
      <button class="primary wide" id="saveEdit">Save</button>
      <div class="row"><button class="small" id="resetCard">Reset progress</button><button class="small danger" id="delCard">Delete card</button></div>
    </div>`;
  const backTo = { name: "browse", deck: view.deck, q: view.q };
  wireBack(backTo);
  $("#saveEdit").onclick = () => {
    const f = $("#front").value.trim(), b = $("#backF").value.trim();
    if (!f || !b) return toast("Front and back can't be empty.");
    c.front = f; c.back = b; c.extra = $("#extra").value.trim(); c.alts = []; save(); toast("Saved"); go(backTo);
  };
  armed($("#resetCard"), "Tap again to reset", () => { Object.assign(c, { state: "new", due: 0, stab: 0, diff: 0, reps: 0, lapses: 0, last: 0 }); save(); toast("Progress reset"); go(backTo); });
  armed($("#delCard"), "Tap again to delete", () => { S.cards = S.cards.filter(x => x !== c); save(); toast("Card deleted"); go(backTo); });
}

// --- Deck options
function options() {
  const d = deckById(view.deck); if (!d) return go({ name: "home" });
  const sel = (id, list, v) => `<select id="${id}">${list.map(n => `<option value="${n}" ${n === v ? "selected" : ""}>${n === 9999 ? "No limit" : n}</option>`).join("")}</select>`;
  app.innerHTML = `${header("Options", true)}
    <div class="panel">
      <div class="field"><label for="dname">Deck name</label><input type="text" id="dname" value="${esc(d.name)}"></div>
      <div class="field"><label>Answer mode</label>
        <div class="seg"><button type="button" data-mode="flip" aria-pressed="${d.opts.mode === "flip"}">Flip the card</button><button type="button" data-mode="type" aria-pressed="${d.opts.mode === "type"}">Type the answer</button></div>
        <span class="help">Flip: you think of the answer, turn the card and grade yourself, like Anki. Type: you type it, the app checks it and suggests a grade.</span></div>
      <div class="field"><label for="npd">New cards per day</label>${sel("npd", [5, 10, 15, 20, 30, 50, 100], d.opts.newPerDay)}<span class="help">More new cards = faster progress, but more reviews in the following days.</span></div>
      <div class="field"><label for="mr">Maximum reviews per day</label>${sel("mr", [50, 100, 200, 300, 500, 9999], d.opts.maxReviews)}<span class="help">A ceiling, so a few missed days never turn into a mountain.</span></div>
      <button class="primary wide" id="saveOpt">Save</button>
    </div>
    <div class="panel"><button class="danger" id="delDeck">Delete this deck and its ${cardsOf(d.id).length} cards</button></div>`;
  wireBack({ name: "deck", deck: d.id });
  let mode = d.opts.mode;
  document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { mode = b.dataset.mode; document.querySelectorAll("[data-mode]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  $("#saveOpt").onclick = () => {
    d.name = $("#dname").value.trim() || d.name; d.opts = { mode, newPerDay: +$("#npd").value, maxReviews: +$("#mr").value };
    save(); toast("Options saved"); go({ name: "deck", deck: d.id });
  };
  armed($("#delDeck"), "Tap again to delete everything", () => { S.decks = S.decks.filter(x => x !== d); S.cards = S.cards.filter(c => c.deck !== d.id); save(); toast("Deck deleted"); go({ name: "home" }); });
}

// --- Study: the card turns over
function startStudy(d, extraNew = 0) {
  if (extraNew) { S.extraNew = S.extraNew || {}; S.extraNew[introKey(d.id)] = extraToday(d.id) + extraNew; save(); }
  ses = { deck: d.id, queue: buildQueue(d), done: 0, flipped: false, typed: "", verdict: "", hint: false };
  go({ name: "study", deck: d.id });
}
function suggestion() { // typed mode only
  if (ses.verdict === "giveup" || ses.verdict === "wrong") return 1;
  if (ses.verdict === "almost" || ses.hint) return 2;
  return 3; // right on your own: Good. Keep Easy for answers that were truly effortless.
}
const VERDICT = { exact: "Right", almost: "Almost: one typo or a word missing", wrong: "Not right", giveup: "You gave up" };
function study() {
  const d = deckById(ses ? ses.deck : view.deck);
  if (!d || !ses) return go({ name: "home" });
  const c = cardById(ses.queue[0]);
  if (!c) { // session finished
    const k = counts(d);
    app.innerHTML = `${header(d.name, true)}
      <div class="panel empty"><div class="big">Well done</div>
        <p style="margin:0">${ses.done} card${ses.done === 1 ? "" : "s"} studied. You've finished this deck for now.</p>
        ${k.newLeft ? `<button class="wide" id="moreBtn">Study 10 more new cards</button>` : ""}
        <button class="primary wide" id="homeBtn">Back to decks</button></div>`;
    wireBack({ name: "deck", deck: d.id });
    const mb = $("#moreBtn"); if (mb) mb.onclick = () => startStudy(d, 10);
    $("#homeBtn").onclick = () => go({ name: "home" });
    return;
  }
  const typeMode = d.opts.mode === "type";
  const left = ses.queue.map(cardById).filter(Boolean);
  const nNew = left.filter(x => x.state === "new").length;
  const stateTag = c.state === "new" ? "New" : c.state === "learning" ? "Again" : "Review";
  app.innerHTML = `
    <div class="study-top"><button class="back-btn" id="back" aria-label="Back">‹</button><h1>${esc(d.name)}</h1>${nums(nNew, left.length - nNew)}</div>
    <div class="scene enter"><div class="flip" id="flip">
      <div class="face front"><div class="tag"><span>${stateTag}</span></div>
        <div class="q">${esc(c.front)}</div>
        ${typeMode ? `<div class="spacer"></div><div id="hintBox"></div>`
          : `<div class="spacer"></div><div class="tap">Tap the card to turn it over</div>`}
      </div>
      <div class="face back" id="backFace"></div>
    </div></div>
    <div id="controls">${typeMode ? `<div class="answer-box">
        <input type="text" id="ans" aria-label="Your answer" placeholder="Type your answer" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go">
        <button class="small" id="hintBtn" style="align-self:flex-start">Hint</button></div>
      <div class="pair"><button class="giveup" id="giveUp">I give up</button><button class="primary" id="showBtn">Check</button></div>` : `<button class="primary wide" id="showBtn">Show answer</button>`}</div>`;
  wireBack({ name: "deck", deck: d.id });
  const reveal = () => {
    if (ses.flipped) return;
    ses.flipped = true;
    if (typeMode && !ses.verdict) { ses.typed = $("#ans").value; ses.verdict = check(ses.typed, c); }
    const sug = typeMode ? suggestion() : 0;
    $("#backFace").innerHTML = `<div class="tag"><span>${stateTag}</span></div>
      <div class="q small-q">${esc(c.front)}</div>
      ${typeMode ? `<div class="verdict g${ses.verdict === "exact" ? 3 : sug}">${VERDICT[ses.verdict]}${ses.hint && ses.verdict === "exact" ? " (with the hint)" : ""}</div>${ses.typed.trim() && ses.verdict !== "giveup" ? `<div class="yours">You typed: ${esc(ses.typed)}</div>` : ""}` : ""}
      <div class="a">${typeMode && ses.typed.trim() && ses.verdict !== "giveup" && ses.verdict !== "exact" ? markMissing(ses.typed, c.back) : esc(c.back)}</div>
      ${c.extra ? `<div class="x">${esc(c.extra)}</div>` : ""}`;
    requestAnimationFrame(() => $("#flip").classList.add("turned"));
    const o = outcomes(c);
    $("#controls").innerHTML = `<div class="grades">${[1, 2, 3, 4].map(g => `<button class="g-${g}${g === sug ? " suggest" : ""}" data-g="${g}">${["Again", "Hard", "Good", "Easy"][g - 1]}<small>${fmtIvl(o[g].ivl)}</small></button>`).join("")}</div>`;
    document.querySelectorAll("[data-g]").forEach(b => b.onclick = () => grade(+b.dataset.g));
  };
  const grade = g => {
    answer(cardById(c.id) || c, g); ses.done++; // the card itself may have just been refreshed by a sync
    ses.queue.shift();
    if (g === 1) ses.queue.splice(Math.min(3, ses.queue.length), 0, c.id); // see it again a few cards later
    Object.assign(ses, { flipped: false, typed: "", verdict: "", hint: false });
    render();
  };
  ses.reveal = reveal; ses.grade = grade;
  $("#showBtn").onclick = reveal;
  if (!typeMode) $("#flip").onclick = reveal;
  else {
    const ans = $("#ans");
    ans.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); reveal(); } };
    $("#giveUp").onclick = () => { ses.typed = ans.value; ses.verdict = "giveup"; reveal(); };
    $("#hintBtn").onclick = () => { ses.hint = true; $("#hintBox").innerHTML = `<div class="hint">${esc(hintOf(c.back))}</div>`; $("#hintBtn").remove(); ans.focus(); };
    if (matchMedia("(pointer: fine)").matches) ans.focus();
  }
}

// --- Settings: install, account and sync
function settings() {
  const total = S.cards.length;
  const studied = S.cards.filter(c => c.state !== "new").length;
  let account;
  if (!window.cloud) account = `<p class="muted" style="margin:0">Loading… If this stays, the sync service can't be reached from this network.</p>`;
  else if (!window.cloud.user) account = `<p style="margin:0">Sign in with Google to keep your decks and progress on all your devices (phone, computer…).</p>
      <button class="primary" id="signIn">Sign in with Google</button>`;
  else if (sync.state === "choice" && sync.pending) {
    const r = sync.pending.r, rStudied = r.cards.filter(c => c.state !== "new").length;
    account = `<p style="margin:0">Signed in as <b>${esc(window.cloud.user.email)}</b>. Your account and this device both have progress. Which one do you keep?</p>
      <button class="primary" id="keepCloud">Keep my account: ${rStudied} cards studied, ${r.decks.length} deck${r.decks.length === 1 ? "" : "s"} (saved ${new Date(sync.pending.updated).toLocaleDateString("en-GB")})</button>
      <button id="keepLocal">Keep this device: ${studied} cards studied, ${S.decks.length} deck${S.decks.length === 1 ? "" : "s"}</button>
      <p class="muted small-text" style="margin:0">The other version is replaced.</p>`;
  } else account = `<p style="margin:0">Signed in as <b>${esc(window.cloud.user.email)}</b>. Your decks are saved in your account and follow you on every device.</p>
      <p class="muted small-text" style="margin:0" id="syncBadge">${syncText()}${sync.last ? ` · ${new Date(sync.last).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
      <div class="row"><button class="small" id="syncBtn">Sync now</button><button class="small" id="signOut">Sign out</button></div>
      <button class="link danger" id="delAcc" style="align-self:flex-start">Delete my account</button>`;
  const install = isInstalled() ? `<p style="margin:0">✓ Hfad is installed on this device. It opens from its icon and works without internet.</p>`
    : installPrompt ? `<p style="margin:0">Add Hfad to this device like a real app: its own icon, full screen, works without internet.</p><button class="primary" id="installBtn">Install Hfad</button>`
    : isIOS() ? `<p style="margin:0">Add Hfad to your home screen like a real app: its own icon, full screen, works without internet.</p>
        <ol class="small-text" style="margin:0;padding-left:1.2em"><li>Open this page in <b>Safari</b>.</li><li>Tap <b>Share</b> (the square with an arrow).</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>`
    : `<p style="margin:0">Add Hfad to this device like a real app: in Chrome or Edge, use the <b>Install</b> icon at the right of the address bar, or the browser menu → <b>Install Hfad</b>.</p>`;
  app.innerHTML = `${header("Settings")}
    <div class="panel">
      <h2>Install the app</h2>
      ${install}
    </div>
    <div class="panel">
      <h2>Account and sync</h2>
      ${account}
    </div>
    <div class="panel">
      <h2>How cards are scheduled</h2>
      <p class="muted small-text" style="margin:0">Hfad uses FSRS, the same scheduler as recent versions of Anki. It aims for a 90% chance that you still remember a card when it comes back: cards you know well come back after longer and longer gaps, cards you forget come back sooner.</p>
    </div>
    <p class="muted small-text" style="margin:0;text-align:center"><a href="privacy.html" style="color:var(--accent)">Privacy</a> · No ads, no tracking, your data is never sold.</p>`;
  const on = (id, f) => { const el = $("#" + id); if (el) el.onclick = f; };
  on("installBtn", async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; render(); });
  on("signIn", async () => { try { await window.cloud.signIn(); } catch (e) { toast("Sign-in failed: " + (e.code || "try again")); } });
  on("signOut", async () => { await window.cloud.signOut(); toast("Signed out. Your cards stay on this device."); render(); });
  on("delAcc", async e => {
    const b = e.currentTarget;
    if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Tap again to delete your account and its saved data for good"; return; }
    b.disabled = true; b.textContent = "Deleting…";
    clearTimeout(pushTimer);
    try { await window.cloud.deleteAccount(); S.syncedTo = null; saveLocal(); toast("Account deleted. Your cards stay on this device only."); }
    catch (err) {
      if (err.nothingDeleted) { toast("Couldn't delete: check your internet and try again"); render(); return; }
      S.syncedTo = null; saveLocal(); await window.cloud.signOut().catch(() => {}); toast("Your saved data is deleted. To finish, sign in again and tap Delete once more."); }
    render();
  });
  on("syncBtn", () => syncNow().then(render));
  on("keepCloud", () => { takeRemote(sync.pending.r); sync.pending = null; sync.state = "ok"; toast("Your account's data is now on this device"); go({ name: "home" }); });
  on("keepLocal", () => { sync.pending = null; S.syncedTo = window.cloud.user.uid; S.updated = Date.now(); saveLocal(); payload().then(window.cloud.push).then(() => { sync.state = "ok"; sync.last = Date.now(); toast("This device's data is now saved in your account"); render(); }); });
}

// ============================================================================
// 6. Start
// ============================================================================
document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => go({ name: b.dataset.tab === "decks" ? "home" : b.dataset.tab }));
document.addEventListener("click", e => { const t = e.target.closest("[data-tip]"); if (t) toast(t.dataset.tip); }); // tap a square or a bar to read its value
document.addEventListener("keydown", e => { // keyboard: space/enter turns the card, 1–4 grade it
  if (e.defaultPrevented || view.name !== "study" || !ses || /input|textarea|select/i.test(e.target.tagName)) return; // the answer box handles its own Enter
  if (!ses.flipped && (e.key === " " || e.key === "Enter")) { e.preventDefault(); ses.reveal && ses.reveal(); }
  else if (ses.flipped && "1234".includes(e.key)) ses.grade(+e.key);
  else if (ses.flipped && (e.key === " " || e.key === "Enter")) { e.preventDefault(); const s = document.querySelector(".grades .suggest") || document.querySelector(".g-3"); s && s.click(); }
});
// ============================================================================
// 7. Installable app (PWA): works offline, can be added to the home screen.
// ============================================================================
let installPrompt = null; // Android and desktop Chrome/Edge offer a one-tap install
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; if (view.name === "settings") render(); });
window.addEventListener("appinstalled", () => { installPrompt = null; toast("Hfad is installed"); if (view.name === "settings") render(); });
const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});

load();
if (!S.welcomed) view = { name: "welcome" };
render();
