// Screenshots of the preview build for visual checks: npm run build && npm run preview, then
//   node scripts/screenshots.mjs <out dir> [base url]
// Uses the locally installed Chrome (playwright-core, no browser download). Set CHROME to override.
import { chromium } from "playwright-core";

const out = process.argv[2] ?? ".";
const base = process.argv[3] ?? "http://localhost:4173/";
const executablePath = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath });

const phone = await browser.newPage({ viewport: { width: 360, height: 760 }, locale: "en-US" });
await phone.goto(`${base}#/pod`);
await phone.screenshot({ path: `${out}/pod-start.png` });
await phone.getByRole("button", { name: /Demo pod/ }).click();
await phone.getByText("/prog/solo.json").waitFor();
await phone.screenshot({ path: `${out}/pod-connected.png`, fullPage: true });

const desk = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: "de-DE", colorScheme: "dark" });
await desk.goto(`${base}#/pod`);
await desk.getByRole("button", { name: /Demo-Pod/ }).click();
await desk.getByText("/prog/solo.json").waitFor();
await desk.screenshot({ path: `${out}/pod-desktop.png` });
await desk.getByRole("link", { name: "Einstellungen" }).first().click();
await desk.getByText("Debug-Konsole").click();
await desk.screenshot({ path: `${out}/settings-desktop.png` });

await browser.close();
console.log(`screenshots written to ${out}`);
