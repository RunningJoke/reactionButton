import { create } from "zustand";

export type ConnectionState = "disconnected" | "connecting" | "connected";
export type TransportKind = "ble" | "serial" | "simulated";

type ConnectionStore = {
  state: ConnectionState;
  transport: TransportKind | null;
  setState: (state: ConnectionState, transport?: TransportKind | null) => void;
};

/** UI view of the pod connection. Filled by the PodClient from P1/P2 on. */
export const useConnection = create<ConnectionStore>((set) => ({
  state: "disconnected",
  transport: null,
  setState: (state, transport = null) => set({ state, transport }),
}));
