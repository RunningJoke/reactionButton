// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import i18n from "../i18n";
import { ConnectionChip } from "../app/ConnectionChip";
import { connectPod, usePodSession, usePodSessions } from "../pod/session";
import { MemoryStorage } from "../store/programStore";
import { useWorkspace } from "../store/workspace";
import { PodPage, PodStatusText } from "./PodPage";
import { PushDone } from "./PodSync";

async function endAll() {
  for (const entry of usePodSessions.getState().entries) await entry.store.getState().disconnect();
  usePodSessions.setState({ entries: [], activeId: null });
}

const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

/** The menu of the connected pod in another order: a change the pods do not have yet. */
async function reorderMenu() {
  const menu = usePodSession.getState().list!.menu;
  await useWorkspace.getState().setMenu([...menu].reverse());
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  await endAll();
  useWorkspace.setState({ loaded: false, programs: [], menu: undefined, sync: null, storage: new MemoryStorage() });
});
afterEach(async () => {
  cleanup();
  await endAll();
});

describe("This set", () => {
  it("shows one quiet line and the battery of each pod when everything is on the pods", async () => {
    await connectPod("simulated");
    inRouter(<PodPage />);
    await waitFor(() => expect(screen.getByText("Everything is on the pods")).toBeTruthy());
    expect(screen.getByText(/Battery 67 %/)).toBeTruthy();
    expect(screen.queryByText(/ V$/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Send to pods" })).toBeNull();
  });

  it("lists unsent changes in words, never as file paths", async () => {
    await connectPod("simulated");
    await reorderMenu();
    inRouter(<PodPage />);
    await waitFor(() => expect(screen.getByText("1 change is not on the pods yet")).toBeTruthy());
    expect(screen.getByText("Pod menu: new order")).toBeTruthy();
    expect(screen.queryByText(/programs\.json/)).toBeNull();
    expect(screen.getByRole("button", { name: "Send to pods" })).toBeTruthy();
  });

  it("marks the connection chip while changes are not on the pods", async () => {
    await connectPod("simulated");
    inRouter(<ConnectionChip />);
    await waitFor(() => expect(screen.getByText("Connected")).toBeTruthy());
    expect(screen.queryByRole("img", { name: "Changes not on the pods yet" })).toBeNull();
    await reorderMenu();
    await waitFor(() => expect(screen.getByRole("img", { name: "Changes not on the pods yet" })).toBeTruthy());
  });
});

describe("pod status text", () => {
  it("says what is wrong in words and shows nothing for an unknown battery", () => {
    const { rerender } = render(<PodStatusText health="low" percent={12} />);
    expect(screen.getByText(/Battery low · 12 %, charge soon/)).toBeTruthy();
    rerender(<PodStatusText health="online" />);
    expect(screen.getByText("Online")).toBeTruthy();
    expect(screen.queryByText(/Battery/)).toBeNull();
    rerender(<PodStatusText health="offline" />);
    expect(screen.getByText("Not found")).toBeTruthy();
  });
});

describe("reset menu result", () => {
  it("says what happened, not how many files", () => {
    render(<PushDone mode="restore" result={{ uploaded: ["/programs.json"], podIssues: [], stopped: false }} />);
    expect(screen.getByText("Menu reset")).toBeTruthy();
    expect(screen.getByText(/default menu, the shipped games and the library again/)).toBeTruthy();
    expect(screen.queryByText(/1 file/)).toBeNull();
    expect(screen.getByText("Switch on all pods.")).toBeTruthy();
  });
});
