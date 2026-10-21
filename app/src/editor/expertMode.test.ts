import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadExpertMode, useExpertModeStore } from "./expertMode";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("expert mode", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("is off by default", () => {
    reloadExpertMode();
    expect(useExpertModeStore.getState().on).toBe(false);
  });

  it("is remembered", () => {
    reloadExpertMode();
    useExpertModeStore.getState().set(true);
    useExpertModeStore.setState({ on: false });
    reloadExpertMode();
    expect(useExpertModeStore.getState().on).toBe(true);
  });

  it("works when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    reloadExpertMode();
    expect(useExpertModeStore.getState().on).toBe(false);
    useExpertModeStore.getState().set(true);
    expect(useExpertModeStore.getState().on).toBe(true);
  });
});
