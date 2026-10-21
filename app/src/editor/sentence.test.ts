import { beforeAll, describe, expect, it } from "vitest";
import i18next, { type TFunction as I18nT } from "i18next";
import { DEFAULT_FILES } from "../defaults";
import { resolveProgram, type Block } from "@reactpod/program-model";
import en from "../i18n/en.json";
import de from "../i18n/de.json";
import { repeatSentence, stepSentence, type TFunction } from "./sentence";

let tEn: TFunction;
let tDe: TFunction;

beforeAll(async () => {
  const make = async (lng: string) => {
    const i = i18next.createInstance();
    await i.init({ lng, resources: { en: { translation: en }, de: { translation: de } }, fallbackLng: "en", interpolation: { escapeValue: false } });
    return i.t.bind(i) as I18nT as unknown as TFunction;
  };
  tEn = await make("en");
  tDe = await make("de");
});

const b = (block: Record<string, unknown>) => ({ name: "X", ...block }) as Block;
const en_ = (block: Record<string, unknown>, options = {}) => stepSentence(b(block), tEn, options);

describe("step sentences", () => {
  it("lights and turns off the central", () => {
    expect(en_({ type: "led", color: "green" })).toBe("Light the central green");
    expect(en_({ type: "led", color: "off" })).toBe("Turn the central's LEDs off");
    expect(en_({ type: "led", color: "red", leds: [0, 1, 2] })).toBe("Light 3 LEDs of the central red");
    expect(en_({ type: "led", color: [10, 20, 30] })).toBe("Light the central in a custom colour");
  });

  it("uses seconds, not ms", () => {
    expect(en_({ type: "delay", ms: 2500 })).toBe("Wait 2.5 s");
    expect(en_({ type: "delay", minMs: 1000, maxMs: 3000 })).toBe("Wait 1–3 s (random)");
    expect(en_({ type: "delay", ms: 0 })).toBe("Go on right away");
    expect(en_({ type: "delay", ms: "PAUSE_MS" })).toBe("Wait PAUSE_MS");
    expect(stepSentence(b({ type: "delay", minMs: 500, maxMs: 2000 }), tDe)).toBe("0,5–2 s warten (zufällig)");
  });

  it("describes presses with their time limit and the false-start pause", () => {
    expect(en_({ type: "button", pressed: "A" })).toBe("Wait for a press on the central");
    expect(en_({ type: "button", pressed: "A", timeoutMs: 2000, timeout: "B", record: "reaction" })).toBe("Wait for a press on the central · max 2 s");
    expect(en_({ type: "button", minTimeoutMs: 800, maxTimeoutMs: 5000, pressed: "False", timeout: "Go" })).toBe(
      "Wait 0.8–5 s (random), pressing now is a false start",
    );
    expect(en_({ type: "button", short: "A", long: "B", shortMs: 1500 })).toBe("Wait for a press on the central · long press from 1.5 s");
  });

  it("counts pods from 1", () => {
    expect(en_({ type: "remotePress", pod: 0, record: "reaction" })).toBe("Light pod 1 green, wait for the press");
    expect(en_({ type: "remotePress", pod: 2, color: "blue", timeoutMs: 5000 })).toBe("Light pod 3 blue, wait for the press · max 5 s");
    expect(en_({ type: "remotePress", pod: 1, mode: "avoid" })).toBe("Light pod 2 red: don't touch it");
    expect(en_({ type: "remotePress", pod: "SELECTED_BUZZER" }, { chosenPods: new Set(["SELECTED_BUZZER"]) })).toBe("Light the chosen pod green, wait for the press");
    expect(en_({ type: "remotePress", pod: "TARGET" })).toBe("Light the pod in TARGET green, wait for the press");
  });

  it("describes several pods at once", () => {
    expect(en_({ type: "remoteMultiPress", pods: "REQUIRED_PERIPHERALS", avoid: 2 })).toBe("Light all pods green at once, wait until each one is pressed · 2 of them red: don't touch");
    expect(en_({ type: "remoteMultiPress", pods: 3, hitColor: "cyan", timeoutMs: 1500 })).toBe("Light 3 pods cyan at once, wait until each one is pressed · max 1.5 s");
    expect(en_({ type: "remoteResetAll" })).toBe("Turn all pods off");
  });

  it("describes counting, choosing and deciding in words", () => {
    expect(en_({ type: "setVariable", var: "MISSES", op: "+", value: 1 })).toBe("Add 1 to MISSES");
    expect(en_({ type: "setVariable", var: "MISSES", value: 0 })).toBe("Set MISSES to 0");
    expect(en_({ type: "setVariable", var: "SEL", op: "random", value: "REQUIRED_PERIPHERALS" })).toBe("Choose a random pod");
    expect(en_({ type: "setVariable", var: "SEL", op: "randomOther", value: "NODE_COUNT" })).toBe("Choose a random pod or the central, never the same twice");
    expect(en_({ type: "if", left: "MISSES", op: ">=", right: 3 })).toBe("Check: is MISSES at least 3?");
    expect(en_({ type: "if", left: "SEL", op: "==", right: "REQUIRED_PERIPHERALS" })).toBe("Check: is SEL equal to the number of pods?");
    expect(en_({ type: "summary", metric: "reaction", storeAverage: "A", storeBest: "B" })).toBe("Show the results: average, best");
    expect(en_({ type: "summary", metric: "reaction" })).toBe("Show the results");
  });

  it("shows fixed settings as their values", () => {
    const values = { PAUSE_MS: 2000, AVOID_COUNT: 2, TARGET: 1 };
    expect(en_({ type: "delay", ms: "PAUSE_MS" }, { values })).toBe("Wait 2 s");
    expect(en_({ type: "remoteMultiPress", avoid: "AVOID_COUNT" }, { values })).toBe("Light all pods green at once, wait until each one is pressed · 2 of them red: don't touch");
    expect(en_({ type: "remoteMultiPress", avoid: "AVOID_COUNT" }, { values: { AVOID_COUNT: 0 } })).toBe("Light all pods green at once, wait until each one is pressed");
    expect(en_({ type: "remotePress", pod: "TARGET" }, { values })).toBe("Light pod 2 green, wait for the press");
  });

  it("uses a label function for settings", () => {
    expect(en_({ type: "setVariable", var: "MISSES", op: "+", value: 1 }, { label: (n: string) => (n === "MISSES" ? "Misses" : n) })).toBe("Add 1 to Misses");
  });

  it("describes repeat with the start value of its setting", () => {
    expect(en_({ type: "repeat", count: 3 })).toBe("Repeat 3 rounds");
    expect(repeatSentence("ROUNDS", tEn, { values: { ROUNDS: 12 } })).toBe("Repeat 12 rounds");
    expect(repeatSentence("ROUNDS", tEn)).toBe("Repeat ROUNDS rounds");
    expect(repeatSentence(1, tDe)).toBe("1 Runde wiederholen");
  });

  it("never shows raw field names, ms or pod 0 for the shipped programs", () => {
    const paths = Object.keys(DEFAULT_FILES).filter((p) => p.startsWith("/prog/") && !p.startsWith("/prog/lib/"));
    for (const path of paths) {
      for (const { block } of resolveProgram(path, (p) => DEFAULT_FILES[p]).blocks) {
        for (const t of [tEn, tDe]) {
          const text = stepSentence(block as Block, t, { chosenPods: new Set(["SELECTED_BUZZER"]) });
          expect(text, `${path} ${String((block as Block).name)}`).not.toMatch(/\bms\b|timeoutMs|minMs|record|storeAs|\bpod 0\b|\bPod 0\b|undefined| \?( |$)|sentence\./);
        }
      }
    }
  });
});
