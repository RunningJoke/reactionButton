/**
 * Expert mode (docs/app/editor-ux.md §4 H): block names, port selects, raw keys and block types in
 * the editor. Off by default, remembered per device in localStorage.
 */
import { create } from "zustand";

const STORAGE_KEY = "reactpod.expertMode";

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

type Store = { on: boolean; set: (on: boolean) => void };

export const useExpertModeStore = create<Store>((set) => ({
  on: read(),
  set(on) {
    set({ on });
    try {
      localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    } catch {
      // storage blocked: the setting lasts for this session
    }
  },
}));

/** `[on, setOn]`, like useState. */
export function useExpertMode(): [boolean, (on: boolean) => void] {
  const on = useExpertModeStore((s) => s.on);
  const set = useExpertModeStore((s) => s.set);
  return [on, set];
}

/** Reads the stored value again (tests, or after storage changed in another tab). */
export function reloadExpertMode() {
  useExpertModeStore.setState({ on: read() });
}
