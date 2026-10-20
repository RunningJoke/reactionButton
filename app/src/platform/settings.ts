/**
 * Platform account settings (docs/platform/spec.md §5.4): server, session token, club. Kept in
 * localStorage on this device; the platform is optional, the app works without it.
 */
import { create } from "zustand";
import { PlatformClient, type Fetch } from "./api";

export type PlatformSettings = {
  /** API base URL, e.g. https://api.example.org (no real server yet) */
  baseUrl: string;
  /** bearer session token from /v1/auth/verify, or pasted */
  token: string;
  tokenExpiresAt?: string;
  email?: string;
  /** club (organisation) results are uploaded to */
  orgId?: string;
  orgName?: string;
  /** upload by itself when online */
  autoUpload: boolean;
};

const STORAGE_KEY = "reactpod.platform";
const EMPTY: PlatformSettings = { baseUrl: "", token: "", autoUpload: true };

function read(): PlatformSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<PlatformSettings>) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

type Store = PlatformSettings & {
  update: (patch: Partial<PlatformSettings>) => void;
  signOut: () => void;
};

export const usePlatformSettings = create<Store>((set, get) => {
  const persist = () => {
    const { update: _u, signOut: _s, ...values } = get();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    } catch {
      // storage blocked: the settings last for this session
    }
  };
  return {
    ...read(),
    update(patch) {
      set(patch);
      persist();
    },
    signOut() {
      set({ token: "", tokenExpiresAt: undefined, email: undefined, orgId: undefined, orgName: undefined });
      persist();
    },
  };
});

export const isSignedIn = (s: Pick<PlatformSettings, "baseUrl" | "token">) => s.baseUrl.trim() !== "" && s.token !== "";

/** Upload needs a server, a token and a club. */
export const canUpload = (s: Pick<PlatformSettings, "baseUrl" | "token" | "orgId">) => isSignedIn(s) && Boolean(s.orgId);

export function platformClient(s: Pick<PlatformSettings, "baseUrl" | "token">, fetch?: Fetch): PlatformClient {
  return new PlatformClient({ baseUrl: s.baseUrl.trim(), token: s.token || undefined, fetch });
}
