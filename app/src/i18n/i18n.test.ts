import { describe, expect, it } from "vitest";
import en from "./en.json";
import de from "./de.json";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

function placeholders(text: unknown): string[] {
  return typeof text === "string" ? [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]!).sort() : [];
}

function lookup(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

describe("translations", () => {
  it("German has exactly the English keys", () => {
    expect(keys(de).sort()).toEqual(keys(en).sort());
  });

  it("uses the same placeholders in both languages", () => {
    for (const key of keys(en)) {
      expect(placeholders(lookup(de, key)), key).toEqual(placeholders(lookup(en, key)));
    }
  });

  it("has no empty texts", () => {
    for (const [name, lang] of [["en", en], ["de", de]] as const) {
      for (const key of keys(lang)) expect(lookup(lang, key), `${name}:${key}`).not.toBe("");
    }
  });
});
