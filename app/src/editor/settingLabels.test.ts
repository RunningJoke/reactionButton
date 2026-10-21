import { describe, expect, it } from "vitest";
import i18next from "i18next";
import en from "../i18n/en.json";
import de from "../i18n/de.json";
import { isMsSetting, settingLabel } from "./settingLabels";
import { VARS } from "../wizard/generate";

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", fallbackLng: false, resources: { en: { translation: en }, de: { translation: de } } });

describe("setting labels", () => {
  it("names rounds and counts", () => {
    for (const name of ["ROUNDS", "MAX_LOOPS"]) {
      const s = settingLabel(name, i18n.t);
      expect(s.label).toBe("Rounds");
      expect(s.unit).toBe("count");
      expect(s.toDisplay(12)).toBe(12);
      expect(s.fromDisplay(12)).toBe(12);
    }
    expect(settingLabel("AVOID_COUNT", i18n.t).label).toBe("Red pods");
  });

  it("shows times in seconds and stores whole ms", () => {
    const s = settingLabel("PAUSE_MIN_MS", i18n.t);
    expect(s).toMatchObject({ label: "Shortest pause", unit: "s" });
    expect(s.toDisplay(1500)).toBe(1.5);
    expect(s.fromDisplay(1.5)).toBe(1500);
    expect(s.fromDisplay(0.1234)).toBe(123);
    expect(settingLabel("BEST_REACTION", i18n.t).toDisplay(250)).toBe(0.25);
  });

  it("shows unknown names as they are; an unknown _MS name still in seconds", () => {
    expect(settingLabel("STREAK", i18n.t)).toMatchObject({ label: "STREAK", unit: null });
    expect(settingLabel("STREAK", i18n.t).toDisplay(7)).toBe(7);
    const custom = settingLabel("FLASH_MS", i18n.t);
    expect(custom).toMatchObject({ label: "FLASH_MS", unit: "s" });
    expect(custom.fromDisplay(2)).toBe(2000);
    expect(isMsSetting("FLASH_MS")).toBe(true);
    expect(isMsSetting("ROUNDS")).toBe(false);
  });

  it("labels every variable the wizard writes, in both languages", async () => {
    for (const lng of ["en", "de"]) {
      await i18n.changeLanguage(lng);
      for (const name of Object.values(VARS)) {
        const label = settingLabel(name, i18n.t).label;
        expect(label, name).not.toBe(name);
        expect(label).not.toMatch(/settingLabels\./);
      }
    }
    expect(settingLabel("ROUNDS", i18n.t).label).toBe("Runden");
    await i18n.changeLanguage("en");
  });
});
