const { chromium, devices } = require("playwright");
const url = "file://" + require("path").resolve(__dirname, "..", "index.html");
// Safety copies test: daily copy, restore from this device, cloud copies (fake account), restore from the account, second device.
// Run before a release that touches storage or sync:  node tests/backup.js
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", e => { if (!/firebase|cloud|CORS|fetch/i.test(e.message)) errors.push(e.message); });
  const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) errors.push(m); };
  await page.goto(url); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.tap("#skip");
  // build real progress: a deck with 3 cards, one verb studied
  await page.evaluate(() => { const c = S.cards[0]; Object.assign(c, { state: "review", stab: 10, diff: 5, due: Date.now() + 5 * DAY, last: Date.now(), reps: 3 });
    S.decks.push({ id: "dk1", name: "Mine", opts: defaultOpts() }); ["a","b","c"].forEach((f, i) => S.cards.push({ id: "m" + i, deck: "dk1", front: f, back: f.toUpperCase(), state: "new", due: 0 })); save(); });
  ok((await page.evaluate(() => getCopies().length)) === 0, "no copy before reopening");
  await page.reload(); await page.waitForTimeout(300);
  ok((await page.evaluate(() => getCopies().length)) === 1, "daily copy made on open");
  await page.reload(); await page.waitForTimeout(300);
  ok((await page.evaluate(() => getCopies().length)) === 1, "only one daily copy per day");
  // disaster: everything wiped
  await page.evaluate(() => { S.decks = S.decks.filter(d => d.id !== "dk1"); S.cards = S.cards.filter(c => c.deck !== "dk1"); S.cards[0].state = "new"; S.cards[0].stab = 0; save(); });
  await page.tap('[data-tab="settings"]');
  await page.tap('[data-restore="l0"]'); await page.tap('[data-restore="l0"]'); await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({ n: S.cards.length, mine: S.decks.some(d => d.id === "dk1"), stab: S.cards[0].stab, copies: getCopies().map(c => c.why), view: view.name }));
  ok(st.n === 367 && st.mine && st.stab === 10, "restore brings back deck, cards and progress " + JSON.stringify(st));
  ok(st.copies.length === 1, "untouched starter deck not copied before restoring");
  await page.reload(); ok((await page.evaluate(() => S.cards.length)) === 367, "restore survives a reload");

  // --- cloud: fake account (merge semantics like Firestore setDoc merge)
  await page.evaluate(() => {
    window.__doc = null; window.__writes = 0;
    window.cloud = { user: { uid: "U1", email: "t@x" }, pull: async () => window.__doc && JSON.parse(JSON.stringify(window.__doc)),
      push: async d => { window.__writes++; window.__doc = { ...(window.__doc || {}), ...JSON.parse(JSON.stringify(d)) }; } };
  });
  await page.evaluate(() => syncNow()); await page.waitForTimeout(300);
  ok(await page.evaluate(() => !!__doc.z && !__doc.bk), "first push: account created, no copy yet");
  // pretend the account's version is from yesterday and studied more: today's first push keeps it as a copy
  await page.evaluate(async () => { S.cards[1].state = "review"; S.cards[1].stab = 3; S.cards[1].last = Date.now(); save(); await new Promise(r => setTimeout(r, 1800)); });
  let bk = await page.evaluate(() => (__doc.bk || []).length);
  ok(bk === 1, "first change of the day keeps the account's previous version (" + bk + ")");
  await page.evaluate(async () => { S.cards[2].state = "review"; S.cards[2].last = Date.now(); save(); await new Promise(r => setTimeout(r, 1800)); });
  bk = await page.evaluate(() => (__doc.bk || []).length);
  ok(bk === 1, "second change the same day adds no copy (" + bk + ")");
  // sync bug: the account's cards get wiped (the data survives only in bk)
  await page.evaluate(async () => { const R = await decode(__doc); R.cards = []; R.decks = []; R.gone = { c: Object.fromEntries(S.cards.map(c => [c.id, Date.now()])), d: Object.fromEntries(S.decks.map(d => [d.id, Date.now()])) }; Object.assign(__doc, await encode(R)); __doc.updated = Date.now(); });
  await page.evaluate(() => syncNow()); await page.waitForTimeout(500);
  ok((await page.evaluate(() => S.cards.length)) === 0, "simulated sync bug empties this device too");
  ok((await page.evaluate(() => getCopies()[0].why)) === "Before a sync removed cards", "a copy was taken before the sync removed cards");
  // restore from the ACCOUNT copy through the Settings screen
  await page.evaluate(() => go({ name: "settings" }));
  const keys = await page.$$eval("[data-restore]", bs => bs.map(b => b.dataset.restore));
  ok(keys.includes("a0"), "account copy listed in Settings " + keys);
  await page.tap('[data-restore="a0"]'); await page.tap('[data-restore="a0"]'); await page.waitForTimeout(2500);
  const after = await page.evaluate(async () => { const R = await decode(__doc); return { here: S.cards.length, acct: R.cards.length, mine: R.decks.some(d => d.id === "dk1"), bk: __doc.bk.length }; });
  ok(after.here === 367 && after.acct === 367 && after.mine, "account copy restored on device and pushed to the account " + JSON.stringify(after));
  ok(after.bk === 2, "wiped version kept as a copy before the restore (" + after.bk + ")");
  // a second device joining gets the restored data
  const p2 = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
  const doc = await page.evaluate(() => __doc);
  await p2.goto(url); await p2.tap("#skip");
  await p2.evaluate(d => { window.__doc = d; window.cloud = { user: { uid: "U1", email: "t@x" }, pull: async () => JSON.parse(JSON.stringify(window.__doc)), push: async x => { window.__doc = { ...window.__doc, ...x }; } }; return syncNow(); }, doc);
  await p2.waitForTimeout(500);
  ok((await p2.evaluate(() => [S.cards.length, S.decks.some(d => d.id === "dk1"), S.cards.find(c => c.id === "v1").stab])).join() === "367,true,10", "second device gets the restored cards");
  await browser.close();
  console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nAll good."); process.exit(errors.length ? 1 : 0);
})();
