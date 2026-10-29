import { create } from "zustand";

/**
 * Open state of the pod connection dialog (opened from the header chip, the Pod tab and the training view).
 * `addSet`: offer to connect another set while one is connected already (#46).
 */
export const useConnectDialog = create<{ open: boolean; addSet: boolean; show: () => void; showAddSet: () => void; hide: () => void }>((set) => ({
  open: false,
  addSet: false,
  show: () => set({ open: true, addSet: false }),
  showAddSet: () => set({ open: true, addSet: true }),
  hide: () => set({ open: false, addSet: false }),
}));
