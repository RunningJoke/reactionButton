// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import i18n from "../i18n";
import { MemoryStorage } from "../store/programStore";
import { useWorkspace } from "../store/workspace";
import { MenuPage } from "./MenuPage";

const ROW = 64;

/** jsdom has no layout: give each menu row a fixed 64 px box in list order. */
function rowRect(this: HTMLElement) {
  const i = Array.from(this.parentElement?.children ?? []).indexOf(this);
  return { top: i * ROW, bottom: i * ROW + ROW, left: 0, right: 0, width: 0, height: ROW, x: 0, y: i * ROW, toJSON() {} } as DOMRect;
}

const rowPaths = () => Array.from(document.querySelectorAll("ol li code")).map((c) => c.textContent);

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(rowRect);
  useWorkspace.setState({ loaded: false, programs: [], menu: undefined, sync: null, storage: new MemoryStorage() });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A pointer drag from row 0 to row 2 reorders the menu; the arrows stay. */
async function dragFirstToThird() {
  render(<MemoryRouter><MenuPage /></MemoryRouter>);
  await waitFor(() => expect(rowPaths().length).toBeGreaterThanOrEqual(3));
  const [a, b, c] = rowPaths() as string[];

  const handle = screen.getAllByTitle(/^Drag /)[0]!;
  fireEvent.pointerDown(handle, { pointerId: 1, clientY: 32 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 180 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 180 });

  await waitFor(() => expect(useWorkspace.getState().menu?.slice(0, 3)).toEqual([b, c, a]));
  expect(rowPaths().slice(0, 3)).toEqual([b, c, a]);
  expect(screen.getAllByRole("button", { name: /^Move .* up$/ }).length).toBeGreaterThan(0);
}

describe("pod menu", () => {
  it("a pointer drag from row 0 to row 2 reorders the menu, the arrows stay", async () => {
    await dragFirstToThird();
  });
});

describe("pod menu on desktop (#107)", () => {
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it("opens the LED pattern editor in the right column, and drag and drop still works", async () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    await dragFirstToThird();
    expect(document.querySelector("aside h3")).toBeNull();
    expect(screen.getByText("Pick a game in the list to edit its LED pattern here.")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /^Menu pattern of / })[0]!);
    const side = document.querySelector("aside");
    expect(side?.querySelector("h3")).toBeTruthy();
    expect(side?.textContent).toContain("Menu pattern");
    expect(screen.queryByText("Pick a game in the list to edit its LED pattern here.")).toBeNull();
  });
});
