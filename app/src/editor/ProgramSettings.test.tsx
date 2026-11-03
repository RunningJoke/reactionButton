// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "../i18n";
import { DEFAULT_FILES } from "../defaults";
import { generateProgram } from "../wizard/generate";
import { defaultAnswers } from "../wizard/answers";
import { useExpertModeStore } from "./expertMode";
import type { ProgramJson } from "./ops";
import { ProgramSettings } from "./ProgramSettings";

const STERN = "/prog/stern.json";

/** The panel with its own state; `applied` records every change. */
function Panel({ start, path = STERN, applied }: { start: ProgramJson; path?: string; applied?: ProgramJson[] }) {
  const [json, setJson] = useState(start);
  return (
    <ProgramSettings
      json={json}
      path={path}
      names={["StartLoop"]}
      library={[]}
      apply={(next) => {
        applied?.push(next);
        setJson(next);
      }}
      onFlatten={() => {}}
      onClose={() => {}}
    />
  );
}

describe("Game settings panel", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useExpertModeStore.setState({ on: false });
  });
  afterEach(cleanup);

  it("is one panel: name, pods, tweakable settings, menu and the whole-game switches", () => {
    render(<Panel start={generateProgram({ ...defaultAnswers("star", 3), timeLimit: null }, "repeat")} path="/prog/mine.json" />);
    expect(screen.getByText("Game settings")).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Pods besides the main pod" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Rounds" })).toBeTruthy();
    expect(screen.getByText("For the whole game")).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Show results at the end/ })).toBeTruthy();
    expect(screen.queryByLabelText("Start block")).toBeNull(); // expert only
  });

  it("changes the rounds in steps, one apply each", () => {
    const applied: ProgramJson[] = [];
    render(<Panel start={JSON.parse(DEFAULT_FILES[STERN]!)} applied={applied} />);
    expect(screen.getByRole("group", { name: "Rounds" }).textContent).toContain("12");
    fireEvent.click(screen.getByRole("button", { name: "More: Rounds" }));
    expect(screen.getByRole("group", { name: "Rounds" }).textContent).toContain("13");
    expect(applied).toHaveLength(1);
    expect((applied[0]!.variables as Record<string, number>).MAX_LOOPS).toBe(13);
  });

  it("switches a time limit on and results off for the whole game", () => {
    const applied: ProgramJson[] = [];
    render(<Panel start={generateProgram({ ...defaultAnswers("star", 3), timeLimit: null }, "repeat")} path="/prog/mine.json" applied={applied} />);
    const results = screen.getByRole("switch", { name: /Show results at the end/ }) as HTMLInputElement;
    expect(results.checked).toBe(true);
    fireEvent.click(results);
    fireEvent.click(screen.getByRole("switch", { name: /Time limit/ }));
    expect(screen.getByRole("group", { name: "Seconds to press" }).textContent).toContain("2.00 s");
    fireEvent.click(screen.getByRole("radio", { name: "Count a miss and go on" }));
    const blocks = applied.at(-1)!.blocks as { type: string; timeoutMs?: unknown; var?: string }[];
    expect(blocks.some((b) => b.type === "summary")).toBe(false);
    expect(blocks.filter((b) => b.timeoutMs === 2000).length).toBeGreaterThan(0);
    expect(blocks.some((b) => b.type === "setVariable" && b.var === "MISSES")).toBe(true);
  });

  it("says when a game built from shared game pieces has nothing to switch", () => {
    render(<Panel start={JSON.parse(DEFAULT_FILES[STERN]!)} />);
    expect(screen.getByText(/built from shared game pieces/)).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("shows the expert section only in expert mode", () => {
    render(<Panel start={JSON.parse(DEFAULT_FILES[STERN]!)} />);
    expect(screen.queryByLabelText("Start block")).toBeNull();
    cleanup();
    useExpertModeStore.setState({ on: true });
    render(<Panel start={JSON.parse(DEFAULT_FILES[STERN]!)} />);
    expect(screen.getByLabelText("Start block")).toBeTruthy();
    expect(screen.getByLabelText("Start value of MAX_LOOPS")).toBeTruthy();
  });
});
