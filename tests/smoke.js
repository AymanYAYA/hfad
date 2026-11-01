// Hfad smoke test: walks through every screen on an emulated iPhone and fails on any page error.
// Run before each release:  node tests/smoke.js   (uses the preinstalled Playwright and Chromium)
// Errors from cloud.js / Firebase on file:// are expected and ignored.
const { chromium, devices } = require("playwright");
const path = require("path");
const url = "file://" + path.resolve(__dirname, "..", "index.html");

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
  const errors = [];
  page.on("pageerror", e => { if (!/firebase|cloud|CORS|fetch/i.test(e.message)) errors.push(e.message); });
  const step = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { errors.push(name + ": " + e.message); console.log("FAIL", name); } };
  const text = () => page.textContent("#app");

  await page.goto(url); await page.evaluate(() => localStorage.clear()); await page.reload();
  await step("welcome → home", async () => { await page.tap("#skip"); if (!(await text()).includes("Verbs")) throw new Error("starter deck missing"); });
  await step("study a typed card", async () => {
    await page.tap('[data-deck="verbs"]'); await page.tap("#studyBtn");
    const back = await page.evaluate(() => cardById(ses.queue[0]).back.split("/")[0]);
    await page.fill("#ans", back); await page.tap("#showBtn"); await page.waitForTimeout(700);
    if (!(await page.textContent(".verdict")).startsWith("Right")) throw new Error("right answer not accepted");
    await page.tap('[data-g="3"]');
    if ((await page.evaluate(() => S.log.length)) !== 1) throw new Error("answer not logged");
  });
  await step("wrong answer suggests Again", async () => {
    await page.fill("#ans", "zzzz"); await page.tap("#showBtn"); await page.waitForTimeout(700);
    if (!(await page.$(".g-1.suggest"))) throw new Error("Again not suggested");
    await page.tap('[data-g="1"]');
  });
  await step("create a deck and add cards", async () => {
    await page.tap("#back"); await page.tap("#back");
    await page.fill("#newDeck", "Test deck"); await page.tap("#createDeck");
    await page.fill("#front", "bonjour"); await page.fill("#backF", "hello"); await page.tap("#saveCard");
    await page.tap("#back"); await page.tap("#bulkBtn");
    await page.fill("#lines", "chat ; cat\nchien ; dog ; My dog barks."); await page.tap("#addAll");
    if (!(await text()).includes("3")) throw new Error("cards not added");
  });
  await step("flip mode study", async () => {
    await page.tap("#optBtn"); await page.tap('[data-mode="flip"]'); await page.tap("#saveOpt");
    await page.tap("#studyBtn"); await page.tap("#flip"); await page.waitForTimeout(700); await page.tap('[data-g="4"]');
  });
  await step("browse and edit", async () => {
    await page.tap("#back"); await page.tap("#browseBtn"); await page.fill("#q", "chien");
    await page.tap("[data-card]"); await page.fill("#extra", "Edited."); await page.tap("#saveEdit");
  });
  await step("stats", async () => { await page.tap('[data-tab="stats"]'); if (!(await text()).includes("Remembered")) throw new Error("stats empty"); });
  await step("settings", async () => { await page.tap('[data-tab="settings"]'); if (!(await text()).includes("FSRS")) throw new Error("settings empty"); });
  await step("data survives a reload", async () => {
    await page.reload(); const n = await page.evaluate(() => S.cards.length);
    if (n !== 364 + 3) throw new Error("expected 367 cards, got " + n);
  });

  await browser.close();
  if (errors.length) { console.log("\nErrors:\n" + errors.join("\n")); process.exit(1); }
  console.log("\nAll good.");
})();
