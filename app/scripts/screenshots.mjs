// Screenshots of the preview build for visual checks: npm run build && npm run preview, then
//   node scripts/screenshots.mjs <out dir> [base url]
// Uses the locally installed Chrome (playwright-core, no browser download). Set CHROME to override.
// Labels are read from src/i18n/en.json, so a copy change does not break the selectors.
import { chromium } from "playwright-core";
import en from "../src/i18n/en.json" with { type: "json" };

const out = process.argv[2] ?? ".";
const base = process.argv[3] ?? "http://localhost:4173/";
const executablePath = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const raw = (key) => key.split(".").reduce((node, part) => node[part], en);
const str = (key, vars = {}) => raw(key).replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name]);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A pattern for a string with placeholders: each {{var}} matches anything. */
const re = (key) => new RegExp(raw(key).split(/\{\{\w+\}\}/).map(esc).join(".*"));

const browser = await chromium.launch({ executablePath });
const widths = [360, 1200, 1440];
const themes = ["light", "dark"];

// Settings → Advanced has the demo round result; then back to the training surface
const demoReport = async (page) => {
  await page.goto(`${base}#/settings`);
  await page.getByRole("button", { name: str("training.demoReport") }).click();
  await page.goto(`${base}#/train`);
};
const view = (path, source = "shipped", mode = "about") =>
  `${base}#/games/game?source=${source}&path=${encodeURIComponent(path)}&mode=${mode}`;

// One context per width and theme: a copy of the app's data, the demo pod, and the screens of the design review
for (const width of widths) {
  for (const colorScheme of themes) {
    const tag = `${width}-${colorScheme}`;
    const page = await browser.newPage({ viewport: { width, height: 800 }, locale: "en-US", colorScheme });
    const shot = (name, fullPage = true) => page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage });

    // Results: one athlete (the training surface needs one)
    await page.goto(`${base}#/results`);
    await page.getByRole("button", { name: str("results.addAthlete"), exact: true }).click();
    await page.getByLabel(str("results.athleteName")).fill("Mia");
    await page.getByRole("button", { name: str("pod.save"), exact: true }).click();
    await shot("results-empty");

    // Train: not connected, then the demo pod through "Connect a set"
    await page.goto(`${base}#/train`);
    await shot("train-not-connected");
    await page.getByRole("button", { name: str("training.guide.connect"), exact: true }).click();
    await shot("connect-dialog", false);
    await page.getByRole("button", { name: re("pod.connect.simulated") }).click();
    await page.getByRole("button", { name: "Mia", exact: true }).click();
    await shot("train-idle");
    for (let i = 0; i < 3; i++) {
      await demoReport(page);
      await page.getByRole("button", { name: str("training.repeat"), exact: true }).waitFor();
      if (i === 1) await page.getByRole("button", { name: str("training.repeat"), exact: true }).click();
      else await page.getByRole("button", { name: str("training.continue"), exact: true }).click();
    }
    await demoReport(page);
    await page.getByRole("button", { name: str("training.vars.more", { name: str("settingLabels.rounds") }) }).click();
    await shot("train-waiting");

    // Results: the session of today and the athlete it belongs to
    await page.getByRole("link", { name: str("training.last.all") }).click();
    await page.locator("details summary").first().click();
    await shot("results-session");
    await page.getByRole("link", { name: str("nav.back"), exact: true }).click();
    await shot("results-athlete");

    // This set: the connected pod, its menu, and the game page
    await page.getByRole("button", { name: re("connection.connected") }).click();
    await shot("this-set");
    await page.getByRole("link", { name: str("menu.title") }).click();
    await shot("pod-menu");

    await page.goto(`${base}#/games`);
    await page.getByText(str("programs.shipped")).waitFor();
    await shot("games");
    await page.goto(view("/prog/duo.json"));
    await page.getByRole("tablist").waitFor();
    await page.waitForTimeout(300);
    await shot("game-about");
    await page.getByRole("tab", { name: str("game.mode.edit"), exact: true }).click();
    await page.getByRole("button", { name: str("game.makeCopy"), exact: true }).click();
    await page.waitForTimeout(300);
    await shot("game-edit");
    await page.getByRole("tab", { name: str("game.mode.try"), exact: true }).click();
    await page.waitForTimeout(300);
    await shot("game-try");

    await page.goto(`${base}#/settings`);
    await page.getByText(str("settings.console")).click();
    await shot("settings");
    await page.getByText(str("platform.title")).click();
    await shot("settings-platform");

    await page.close();
  }
}

// Step sheet and Sprinkles (#88): all widths, both themes
for (const width of widths) {
  for (const colorScheme of themes) {
    const tag = `${width}-${colorScheme}`;
    const ed = await browser.newPage({ viewport: { width, height: width === 360 ? 1300 : 900 }, locale: "en-US", colorScheme });
    const edit = async (path) => {
      await ed.goto(view(path));
      await ed.getByRole("button", { name: new RegExp(`${esc(str("game.makeCopy"))}|${esc(str("view.openCopy"))}`) }).first().click();
      await ed.getByText(/^1/).first().waitFor();
    };
    const shot = async (name) => {
      await ed.waitForTimeout(350);
      await ed.screenshot({ path: `${out}/editor-${tag}-${name}.png` });
    };
    await edit("/prog/solo.json");
    await ed.getByRole("button", { name: str("editor.step.add"), exact: true }).click();
    await shot("palette");
    await ed.getByRole("button", { name: str("view.close"), exact: true }).click();
    await ed.getByText(str("sentence.press")).first().click();
    await shot("press");
    await ed.getByRole("button", { name: new RegExp(`^\\+ ${esc(str("editor.switch.timeLimit"))}`) }).click();
    await shot("press-time-limit");
    await ed.getByRole("button", { name: new RegExp(`^${esc(str("editor.exit.role.ifTooSlow"))}`) }).click();
    await shot("exit-picker");
    await ed.getByRole("button", { name: str("nav.back"), exact: true }).click();
    await ed.getByRole("button", { name: str("editor.sprinkle.add") }).click();
    await shot("add-page");
    await ed.getByRole("button", { name: str("nav.back"), exact: true }).click();
    await ed.getByText(/^Wait 0\.8/).first().click();
    await shot("pause");
    await edit("/prog/charge.json");
    await ed.getByText(re("sentence.charge")).first().click();
    await shot("charge");
    await edit("/prog/domination.json");
    await ed.getByText(/^Domination: red against blue/).first().click();
    await shot("domination");
    await ed.close();
  }
}

await browser.close();
console.log(`screenshots written to ${out}`);
