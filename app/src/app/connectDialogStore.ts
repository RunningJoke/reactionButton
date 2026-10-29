import { create } from "zustand";

/**
 * Open state of the pod connection dialog (opened from the header chip, the Pod tab and the training view).
 */
export const useConnectDialog = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
