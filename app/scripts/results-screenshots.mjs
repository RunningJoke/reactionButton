// Screenshots of the Results list, Athlete and Session pages (R3): 360 px, light / dark, English / German.
//   npm run build && npm run preview -- --port 4391 --strictPort, then
//   node scripts/results-screenshots.mjs <out dir> [base url]
// Seeds the results database (IndexedDB "reactpod-results") directly; uses the local Chrome (CHROME to override).
import { chromium } from "playwright-core";

const out = process.argv[2] ?? ".";
const base = process.argv[3] ?? "http://localhost:4391/";
const executablePath = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath });
const DAY = 86_400_000;

function seed() {
  const now = Date.now();
  const athletes = ["Mia", "Ben", "Zoe"].map((name) => ({ id: `ath-${name}`, name, createdAt: now - 30 * DAY }));
  const sessions = [];
  const reports = [];
  const train = (athlete, daysAgo, program, rounds) => {
    const id = `s-${athlete ?? "none"}-${daysAgo}`;
    const startedAt = now - daysAgo * DAY - 3_600_000;
    sessions.push({ id, athleteId: athlete ? `ath-${athlete}` : null, setId: "1a2b3c4d", programPath: program, startedAt, notes: "", upload: {} });
    rounds.forEach((ms, i) => {
      reports.push({
        id: `${id}-r${i}`, sessionId: id, podReportId: i + 1, cycle: i + 1, startMs: 1000 * i, endMs: 1000 * i + 9010,
        recordedAt: startedAt + i * 20_000, discarded: i === 2 && daysAgo === 0, vars: { RUNS: 12 }, stats: {},
        values: ms.map((m, k) => ({ t: 1000 * i + 500 * k, metric: "reaction", pod: (k % 3) + 1, ms: m })),
      });
    });
  };
  [[24, 520], [17, 490], [10, 470], [6, 430], [3, 400], [0, 350]].forEach(([d, base], n) =>
    train("Mia", d, n % 2 ? "/prog/duo.json" : "/prog/solo.json", [0, 1, 2].map((r) => [base + 30, base - 20 + r * 10, base + 5, base - 40, base + 60, base, base - 10, base + 20, base + 15])),
  );
  train("Ben", 9, "/prog/solo.json", [[610, 580, 640], [600, 560]]);
  train("Ben", 8, "/prog/solo.json", [[560, 540, 590]]);
  train(null, 1, "/prog/solo.json", [[700, 650]]);
  return { athletes, sessions, reports };
}

const fill = async (page) => {
  await page.goto(`${base}#/results`);
  await page.waitForTimeout(500);
  await page.evaluate(async (data) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("reactpod-results", 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("athletes", { keyPath: "id" });
        d.createObjectStore("sessions", { keyPath: "id" });
        d.createObjectStore("reports", { keyPath: "id" }).createIndex("sessionId", "sessionId");
        d.createObjectStore("meta");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction(["athletes", "sessions", "reports"], "readwrite");
      for (const [store, rows] of Object.entries(data)) rows.forEach((row) => tx.objectStore(store).put(row));
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, seed());
  await page.reload();
};

for (const [locale, scheme] of [["en-US", "light"], ["en-US", "dark"], ["de-DE", "light"]]) {
  const tag = `${locale.slice(0, 2)}-${scheme}`;
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, locale, colorScheme: scheme });
  const page = await ctx.newPage();
  await fill(page);
  await page.locator("ul a, section a").first().waitFor();
  await page.screenshot({ path: `${out}/list-${tag}.png`, fullPage: true });
  await page.locator("a", { hasText: /^M/ }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/athlete-${tag}.png`, fullPage: true });
  await page.locator("a[href*='results/session']").first().click();
  await page.waitForTimeout(300);
  await page.locator("details summary").first().click();
  await page.screenshot({ path: `${out}/session-${tag}.png`, fullPage: true });
  if (scheme === "light" && locale === "en-US") {
    await page.getByRole("button", { name: "Don't count" }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/session-toast-${tag}.png` });
    await page.getByRole("button", { name: "Delete training" }).click();
    await page.getByRole("button", { name: "Hold to delete" }).dispatchEvent("pointerdown");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/delete-hold-${tag}.png` });
  }
  await ctx.close();
}
await browser.close();
