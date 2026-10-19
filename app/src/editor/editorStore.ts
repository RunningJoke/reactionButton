/**
 * The program open in the editor: the document, undo / redo history and the selected block.
 * Every change is saved to the local store right away.
 */
import { create } from "zustand";
import type { ProgramDoc } from "../store/programStore";
import { useWorkspace } from "../store/workspace";
import type { ProgramJson } from "./ops";

const HISTORY = 100;
/** typing into one field within this time is one undo step */
const MERGE_MS = 1200;

const LAST_KEY = "reactpod.lastProgram";

type Editor = {
  doc: ProgramDoc | null;
  past: ProgramJson[];
  future: ProgramJson[];
  selected: string | null;
  lastChange: { key: string; at: number } | null;

  open: (doc: ProgramDoc) => void;
  close: () => void;
  /** applies a change; changes with the same `mergeKey` in quick succession are one undo step */
  apply: (json: ProgramJson, options?: { mergeKey?: string; select?: string | null }) => void;
  undo: () => void;
  redo: () => void;
  select: (name: string | null) => void;
};

export const useEditor = create<Editor>((set, get) => {
  const persist = (json: ProgramJson) => {
    const doc = get().doc;
    if (!doc) return;
    const next = { ...doc, json };
    set({ doc: next });
    void useWorkspace.getState().save(next);
  };

  return {
    doc: null,
    past: [],
    future: [],
    selected: null,
    lastChange: null,

    open(doc) {
      if (get().doc?.id === doc.id) return;
      set({ doc, past: [], future: [], selected: null, lastChange: null });
      try {
        localStorage.setItem(LAST_KEY, doc.id);
      } catch {
        // storage blocked
      }
    },

    close() {
      set({ doc: null, past: [], future: [], selected: null, lastChange: null });
    },

    apply(json, options = {}) {
      const { doc, past, lastChange } = get();
      if (!doc || json === doc.json) return;
      const now = Date.now();
      const merge = options.mergeKey !== undefined && lastChange?.key === options.mergeKey && now - lastChange.at < MERGE_MS;
      set({
        past: merge ? past : [...past.slice(-(HISTORY - 1)), doc.json],
        future: [],
        lastChange: options.mergeKey !== undefined ? { key: options.mergeKey, at: now } : null,
        ...(options.select !== undefined ? { selected: options.select } : {}),
      });
      persist(json);
    },

    undo() {
      const { doc, past, future } = get();
      if (!doc || past.length === 0) return;
      set({ past: past.slice(0, -1), future: [doc.json, ...future], lastChange: null });
      persist(past[past.length - 1]!);
    },

    redo() {
      const { doc, past, future } = get();
      if (!doc || future.length === 0) return;
      set({ past: [...past, doc.json], future: future.slice(1), lastChange: null });
      persist(future[0]!);
    },

    select(name) {
      set({ selected: name });
    },
  };
});

export function lastOpenedProgram(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
