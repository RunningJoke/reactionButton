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
await phone.getByRole("button", { name: "Connect", exact: true }).click();
await phone.screenshot({ path: `${out}/connect-dialog.png` });
await phone.getByRole("button", { name: /Demo pod/ }).click();
await phone.getByText("/prog/solo.json").waitFor();
await phone.screenshot({ path: `${out}/pod-connected.png`, fullPage: true });
await phone.getByRole("button", { name: "Connected" }).click();
await phone.screenshot({ path: `${out}/connect-dialog-connected.png` });
await phone.keyboard.press("Escape");

const desk = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: "de-DE", colorScheme: "dark" });
await desk.goto(`${base}#/pod`);
await desk.getByRole("button", { name: "Nicht verbunden" }).click();
await desk.getByRole("button", { name: /Demo-Pod/ }).click();
await desk.getByText("/prog/solo.json").waitFor();
await desk.screenshot({ path: `${out}/pod-desktop.png` });
await desk.getByRole("link", { name: "Einstellungen" }).first().click();
await desk.getByText("Debug-Konsole").click();
await desk.screenshot({ path: `${out}/settings-desktop.png` });

// P3: programs list and graphs
await phone.goto(`${base}#/programs`);
await phone.getByText("Shipped programs").waitFor();
await phone.screenshot({ path: `${out}/programs.png`, fullPage: true });
const view = (path, source = "shipped") => `${base}#/programs/view?source=${source}&path=${encodeURIComponent(path)}`;
for (const [name, path] of [["solo", "/prog/solo.json"], ["duo", "/prog/duo.json"], ["run5", "/prog/run5.json"], ["star", "/prog/lib/star.json"]]) {
  await phone.goto(view(path));
  await phone.locator(".rp-card").first().waitFor();
  await phone.waitForTimeout(300);
  await phone.screenshot({ path: `${out}/view-${name}.png` });
}
await phone.locator(".rp-card", { hasText: "SelectPod" }).click();
await phone.waitForTimeout(200);
await phone.screenshot({ path: `${out}/view-star-sheet.png` });

await desk.goto(view("/prog/duo.json"));
await desk.locator(".rp-card").first().waitFor();
await desk.getByRole("button", { name: "Details" }).click();
await desk.locator(".rp-card", { hasText: "CentralPress" }).click();
await desk.waitForTimeout(300);
await desk.screenshot({ path: `${out}/view-duo-desktop.png` });

// Athletes and results (#47): demo pod with sample reports
const coach = await browser.newPage({ viewport: { width: 360, height: 760 }, locale: "en-US" });
await coach.goto(`${base}#/results`);
await coach.getByRole("button", { name: "Add athlete" }).click();
await coach.getByLabel("Name or nickname").fill("Mia");
await coach.getByRole("button", { name: "Save" }).click();
await coach.screenshot({ path: `${out}/results-athletes.png` });
await coach.goto(`${base}#/pod`);
await coach.getByRole("button", { name: "Connect", exact: true }).click();
await coach.getByRole("button", { name: /Demo pod/ }).click();
await coach.getByText("/prog/solo.json").first().waitFor();
await coach.getByLabel("Who trains now").selectOption({ label: "Mia" });
for (let i = 0; i < 3; i++) {
  await coach.getByRole("button", { name: "Demo: send a report" }).click();
  await coach.waitForTimeout(150);
  if (i === 1) await coach.getByRole("button", { name: "Repeat" }).click();
  else await coach.getByRole("button", { name: "Continue" }).click();
  await coach.waitForTimeout(150);
}
await coach.locator("section", { hasText: "Who trains now" }).screenshot({ path: `${out}/pod-training.png` });
await coach.getByRole("link", { name: "Open session" }).click();
await coach.locator("details summary").first().click();
await coach.screenshot({ path: `${out}/results-session.png`, fullPage: true });
await coach.getByRole("link", { name: "Mia" }).click();
await coach.screenshot({ path: `${out}/results-athlete.png`, fullPage: true });
await coach.goto(`${base}#/settings`);
await coach.getByLabel("Server").fill("https://api.example.org");
await coach.screenshot({ path: `${out}/settings-platform.png`, fullPage: true });

await browser.close();
console.log(`screenshots written to ${out}`);
