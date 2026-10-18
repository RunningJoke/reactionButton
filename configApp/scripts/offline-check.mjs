// Checks that the preview build works offline (acceptance test AT-U1 before hosting):
//   npm run build && npm run preview, then node scripts/offline-check.mjs [base url]
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:4173/";
const executablePath = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ locale: "en-US" });
const page = await context.newPage();

await page.goto(`${base}#/programs`);
// the service worker installs on the first visit and controls the page from the next load on
await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
await page.reload();
const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
if (!controlled) throw new Error("service worker does not control the page");
await context.setOffline(true);
await page.reload();
await page.getByRole("heading", { level: 1, name: "Programs" }).waitFor({ timeout: 5000 });
await page.getByRole("link", { name: "Pod" }).first().click();
await page.getByRole("button", { name: /Demo pod/ }).click();
await page.getByText("/prog/solo.json").waitFor({ timeout: 5000 });
console.log("OK: app loads offline and the demo pod works");
await browser.close();
