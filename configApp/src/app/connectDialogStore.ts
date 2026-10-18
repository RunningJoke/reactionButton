import { create } from "zustand";

/** Open state of the pod connection dialog (opened from the header chip and the Pod tab). */
export const useConnectDialog = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
