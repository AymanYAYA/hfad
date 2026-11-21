// Sync test: two (or more) phones sharing one Google account, with a fake account in this script instead of Firebase.
// Nothing reaches the real Firebase: cloud.js and every Google address are blocked; the "account" is one object here
// that behaves like the Firestore document users/{uid} (push = setDoc with merge: fields not sent are kept).
// Covers: adding, editing, deleting cards and decks, two devices, offline then back online, conflicts, restoring a copy.
// Run before a release that touches storage or sync:  node tests/sync.js
const { chromium, devices } = require("playwright");
const url = "file://" + require("path").resolve(__dirname, "..", "index.html");

const account = { doc: null, writes: 0 };               // the fake Firestore document
const offline = new Set();                              // names of devices with no network
const stalled = new Set(), held = [];                   // devices whose writes wait (bad network), and those writes
const errors = [];
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) errors.push(m); };
const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));

let browser;
async function device(name, uid = "U1") {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  await ctx.route(/gstatic\.com|googleapis\.com|firebase/, r => r.abort()); // never the real account
  await ctx.exposeFunction("__pull", () => { if (offline.has(name)) throw new Error("offline"); return clone(account.doc); });
  await ctx.exposeFunction("__push", async d => {
    if (offline.has(name)) throw new Error("offline");
    d = clone(d);
    if (stalled.has(name)) await new Promise(r => held.push(r)); // Firestore keeps a write made on a bad network and sends it later
    account.writes++; account.doc = { ...(account.doc || {}), ...d };
  });
  await ctx.addInitScript(uid => {
    window.__uid = uid;
    window.cloud = { ready: true, user: null, pull: () => window.__pull(), push: d => window.__push(d), signIn() {}, signOut() {} };
  }, uid);
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(name + ": " + e.message));
  await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.tap("#skip");
  p.name = name;
  return p;
}
const signIn = p => p.evaluate(async () => { window.cloud.user = { uid: window.__uid, email: "test@example.com" }; window.dispatchEvent(new CustomEvent("cloud-auth")); await new Promise(r => setTimeout(r, 50)); while (busy) await new Promise(r => setTimeout(r, 20)); });
// One full sync, waiting for it (and for a follow-up sync it may have queued) to finish.
const sync = p => p.evaluate(async () => { clearTimeout(pushTimer); clearTimeout(retryTimer); while (busy) await new Promise(r => setTimeout(r, 20)); await syncNow(); while (busy) await new Promise(r => setTimeout(r, 20)); clearTimeout(retryTimer); return sync.state; });
const tick = () => new Promise(r => setTimeout(r, 5)); // so two changes never share the same millisecond
const run = (p, fn, arg) => p.evaluate(fn, arg);
const card = (p, id) => run(p, id => { const c = S.cards.find(c => c.id === id); return c && { front: c.front, back: c.back, state: c.state, reps: c.reps }; }, id);
const deckIds = p => run(p, () => S.decks.map(d => d.id).sort().join());
const cloudState = async p => run(p, async doc => decode(doc), account.doc);

(async () => {
  browser = await chromium.launch();
  const A = await device("A"), B = await device("B");

  // --- first device: the account starts from it
  await run(A, () => { S.decks.push({ id: "dk1", name: "Mine", opts: defaultOpts() }); ["one", "two", "three"].forEach((f, i) => { const c = newCard("dk1", f, f.toUpperCase()); c.id = "m" + i; S.cards.push(c); }); answer(S.cards[0], 3); });
  await signIn(A);
  ok(account.doc && account.doc.z && (await run(A, () => S.syncedTo)) === "U1", "first device creates the account");
  ok((await cloudState(A)).cards.length === 367, "account holds every card");

  // --- second device, never used: takes the account's data
  await signIn(B);
  ok((await deckIds(B)) === "dk1,verbs" && (await card(B, "m1")).back === "TWO", "new device gets the decks and cards");
  ok((await card(B, "v1")).reps === 1, "new device gets the progress");

  // --- add, edit, delete, one device at a time
  await run(A, () => { const c = newCard("dk1", "four", "FOUR"); c.id = "m3"; S.cards.push(c); save(); });
  await sync(A); await sync(B);
  ok((await card(B, "m3"))?.back === "FOUR", "card added on A appears on B");
  await tick(); await run(B, () => { S.cards.find(c => c.id === "m1").back = "TWO (edited)"; save(); });
  await sync(B); await sync(A);
  ok((await card(A, "m1")).back === "TWO (edited)", "card edited on B is edited on A");
  await tick(); await run(A, () => { S.cards = S.cards.filter(c => c.id !== "m2"); save(); });
  await sync(A); await sync(B); await sync(A); await sync(B);
  ok(!(await card(B, "m2")) && !(await card(A, "m2")) && !(await cloudState(A)).cards.some(c => c.id === "m2"), "card deleted on A is deleted on B and stays deleted");

  // --- nothing changed: no write
  let w = account.writes; await sync(A); await sync(B);
  ok(account.writes === w, "a sync with nothing new writes nothing (" + (account.writes - w) + " writes)");

  // --- both offline, different changes on each, then back online
  offline.add("A"); offline.add("B");
  await tick(); await run(A, () => { answer(S.cards.find(c => c.id === "v2"), 3); const c = newCard("dk1", "five", "FIVE"); c.id = "m4"; S.cards.push(c); save(); });
  await tick(); await run(B, () => { answer(S.cards.find(c => c.id === "v3"), 4); S.cards.find(c => c.id === "m0").back = "ONE (from B)"; save(); });
  ok((await sync(A)) === "error" && (await run(A, () => document.body.textContent.includes("Sync failed") || syncText().includes("failed"))), "offline: sync fails quietly and says it will retry");
  ok((await card(A, "m4"))?.back === "FIVE", "offline: changes stay on the device");
  offline.clear();
  await sync(A); await sync(B); await sync(A);
  for (const [p, n] of [[A, "A"], [B, "B"]]) {
    const s = await run(p, () => ({ v2: S.cards.find(c => c.id === "v2").reps, v3: S.cards.find(c => c.id === "v3").reps, m4: !!S.cards.find(c => c.id === "m4"), m0: S.cards.find(c => c.id === "m0").back, today: (S.daily[dayKey()] || {}).n, log: S.log.filter(l => l.t >= dayStart()).length }));
    ok(s.v2 === 1 && s.v3 === 1 && s.m4 && s.m0 === "ONE (from B)", "back online: " + n + " has both devices' changes " + JSON.stringify(s));
    ok(s.today === 3 && s.log === 3, "back online: " + n + "'s count of cards studied today adds up both devices (" + s.today + ")");
  }

  // --- same card changed on both while offline: the latest change wins everywhere
  offline.add("A"); offline.add("B");
  await run(A, () => { S.cards.find(c => c.id === "m3").back = "FOUR (A)"; save(); });
  await tick(); await run(B, () => { S.cards.find(c => c.id === "m3").back = "FOUR (B, later)"; save(); });
  offline.clear(); await sync(A); await sync(B); await sync(A);
  ok((await card(A, "m3")).back === "FOUR (B, later)" && (await card(B, "m3")).back === "FOUR (B, later)", "same card edited on both: the later edit wins on both");

  // --- deletion against an edit
  offline.add("A"); offline.add("B");
  await run(B, () => { S.cards.find(c => c.id === "m4").back = "FIVE (B)"; save(); });
  await tick(); await run(A, () => { S.cards = S.cards.filter(c => c.id !== "m4"); save(); });
  offline.clear(); await sync(A); await sync(B); await sync(A);
  ok(!(await card(A, "m4")) && !(await card(B, "m4")), "edited on B then deleted on A: deleted on both");
  offline.add("A"); offline.add("B");
  await run(A, () => { S.cards = S.cards.filter(c => c.id !== "m3"); save(); });
  await tick(); await run(B, () => { S.cards.find(c => c.id === "m3").back = "FOUR (kept)"; save(); });
  offline.clear(); await sync(A); await sync(B); await sync(A);
  ok((await card(A, "m3"))?.back === "FOUR (kept)" && (await card(B, "m3"))?.back === "FOUR (kept)", "deleted on A then edited on B: the later edit keeps it on both");

  // --- bad network: A's write waits, B writes meanwhile, then A's older write lands on top
  stalled.add("A");
  await tick(); await run(A, () => { S.cards.find(c => c.id === "m1").back = "TWO (A, slow network)"; save(); });
  const slow = sync(A); await new Promise(r => setTimeout(r, 200));
  await tick(); await run(B, () => { const c = newCard("dk1", "six", "SIX"); c.id = "m5"; S.cards.push(c); save(); });
  await sync(B);
  stalled.clear(); held.splice(0).forEach(r => r()); await slow;
  await sync(A); await sync(B); await sync(A);
  ok((await card(A, "m5"))?.back === "SIX" && (await card(B, "m1")).back === "TWO (A, slow network)" && (await cloudState(A)).cards.some(c => c.id === "m5"),
    "late write from a bad network: nothing lost, both phones and the account end up with everything");

  // --- a whole deck deleted, and a ready-made deck added
  await run(B, () => { addLibraryDeck("phrasal"); });
  await sync(B); await sync(A);
  ok((await deckIds(A)) === "dk1,phrasal,verbs" && (await run(A, () => S.cards.filter(c => c.deck === "phrasal").length)) === 100, "ready-made deck added on B appears on A");
  await tick(); await run(A, () => { S.decks = S.decks.filter(d => d.id !== "phrasal"); S.cards = S.cards.filter(c => c.deck !== "phrasal"); save(); });
  await sync(A); await sync(B); await sync(A);
  ok((await deckIds(B)) === "dk1,verbs" && (await run(B, () => S.cards.filter(c => c.deck === "phrasal").length)) === 0, "deck deleted on A disappears with its cards on B");
  await tick(); await run(B, () => { addLibraryDeck("phrasal"); });
  await sync(B); await sync(A);
  ok((await deckIds(A)) === "dk1,phrasal,verbs" && (await run(A, () => S.cards.filter(c => c.deck === "phrasal").length)) === 100, "the same ready-made deck can be added again after deleting it");

  // --- a sync happening in the middle of a study session
  await run(A, () => { go({ name: "deck", deck: "dk1" }); startStudy(deckById("dk1")); });
  const first = await run(A, () => ses.queue[0]);
  await tick(); await run(B, (id) => { S.cards.find(c => c.id === id).back = "changed on B during A's session"; save(); }, first);
  await sync(B); await sync(A);
  await run(A, () => ses.grade(3)); await sync(A); await sync(B);
  const mid = await card(B, first);
  ok(mid.reps === 1 && mid.back === "changed on B during A's session", "answer given while a sync refreshed the card is kept, with the other device's edit " + JSON.stringify(mid));
  await run(A, () => go({ name: "home" }));

  // --- restoring a safety copy on A wins on B
  const atCopy = (await card(A, "m0")).back; await run(A, () => keepCopy("Test copy"));
  await tick(); await run(B, () => { const c = newCard("dk1", "after", "AFTER"); c.id = "m9"; S.cards.push(c); S.cards.find(c => c.id === "m0").back = "ONE (after the copy)"; save(); });
  await sync(B); await sync(A);
  ok(!!(await card(A, "m9")), "card made after the copy reached A");
  await run(A, async () => { await restoreCopy(getCopies().find(c => c.why === "Test copy")); });
  await sync(A); await sync(B);
  ok(!(await card(B, "m9")) && (await card(B, "m0")).back === atCopy, "restored copy wins on B too (later card removed, old text back)");
  ok((await cloudState(A)).cards.length === (await run(A, () => S.cards.length)), "account holds the restored cards");

  // --- a third phone with its own new cards (never studied) signs in to the same account
  const C = await device("C");
  await run(C, () => { S.decks.push({ id: "dkC", name: "From C", opts: defaultOpts() }); const c = newCard("dkC", "c-front", "c-back"); c.id = "c1"; S.cards.push(c); save(); });
  await signIn(C); await sync(C); await sync(A);
  ok((await deckIds(C)).includes("dkC") && (await deckIds(C)).includes("dk1"), "new phone with its own unstudied deck keeps it and gets the account's decks: " + (await deckIds(C)));
  ok((await deckIds(A)).includes("dkC"), "that deck reaches the other phones");

  // --- a phone that holds another account's progress never overwrites this account
  const D = await device("D");
  await run(D, () => { answer(S.cards[5], 3); S.syncedTo = "OTHER"; saveLocal(); });
  w = account.writes; const before = account.doc.z;
  await signIn(D);
  ok((await run(D, () => sync.state)) === "choice" && account.doc.z === before && account.writes === w, "phone with another account's progress asks which data to keep, account untouched");
  await run(D, async () => { const m = sync.pending; sync.pending = null; await (async () => { takeRemote(m.r); sync.state = "ok"; })(); });
  ok((await deckIds(D)).includes("dk1"), "choosing the account's data loads it");

  // --- an account document made by an older version (plain JSON, no compression) is still read
  const plain = await cloudState(A);
  account.doc = { v: 2, updated: Date.now(), state: JSON.stringify(plain) };
  await tick(); await run(A, () => { S.cards.find(c => c.id === "m0").back = "ONE (v2 doc)"; save(); });
  await sync(A); await sync(B);
  ok((await card(B, "m0")).back === "ONE (v2 doc)" && !!account.doc.z, "old uncompressed account data is read and upgraded");

  await browser.close();
  console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nAll good."); process.exit(errors.length ? 1 : 0);
})().catch(async e => { console.error(e); try { await browser.close(); } catch (_) {} process.exit(1); });
