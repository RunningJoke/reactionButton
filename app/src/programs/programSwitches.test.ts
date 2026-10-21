import { describe, expect, it } from "vitest";
import { hasErrors, validateProgram } from "@reactpod/program-model";
import { ownBlocks, type ProgramJson } from "../editor/ops";
import { generateProgram, type LoopForm } from "../wizard/generate";
import { defaultAnswers, GAMES, gameNeeds, type WizardAnswers } from "../wizard/answers";
import { DEFAULT_FILES } from "../defaults";
import { programSwitchApplies, programSwitchState, programTimeLimit, programTimeoutAction, setProgramSwitch, setProgramTimeLimit } from "./programSwitches";

const PATH = "/prog/adjusted.json";
const FORMS: LoopForm[] = ["counter", "repeat"];

function check(json: ProgramJson, form: LoopForm) {
  const resolved = validateProgram(PATH, (p) => (p === PATH ? JSON.stringify(json) : DEFAULT_FILES[p]), { programFormat: form === "counter" ? 1 : 2 });
  expect(resolved.issues.filter((i) => i.severity === "error"), JSON.stringify(json, null, 1)).toEqual([]);
  expect(hasErrors(resolved.issues)).toBe(false);
}

const answers = (game: (typeof GAMES)[number]): WizardAnswers => defaultAnswers(game, Math.max(gameNeeds(game).minPods, 3));
const types = (json: ProgramJson) => ownBlocks(json).map((b) => b.type);

describe("program switches", () => {
  for (const form of FORMS) {
    for (const game of GAMES) {
      it(`${game} (${form}): every switch turns off and on again and the program stays valid`, () => {
        let json = generateProgram({ ...answers(game), timeLimit: null, measure: { ...answers(game).measure, record: true, results: true } }, form);
        expect(programSwitchState(json, "record")).toBe(true);
        expect(programSwitchState(json, "results")).toBe(true);

        json = setProgramSwitch(json, "results", false);
        expect(types(json)).not.toContain("summary");
        expect(programSwitchState(json, "results")).toBe(false);
        check(json, form);
        json = setProgramSwitch(json, "results", true);
        expect(types(json).filter((t) => t === "summary")).toHaveLength(1);
        check(json, form);

        json = setProgramSwitch(json, "record", false);
        expect(programSwitchState(json, "record")).toBe(false);
        check(json, form);

        expect(programSwitchState(json, "timeLimit")).toBe(false);
        json = setProgramSwitch(json, "timeLimit", true, { onTimeout: "countMiss" });
        expect(programSwitchState(json, "timeLimit")).toBe(true);
        expect(programTimeoutAction(json)).toBe("countMiss");
        expect(programTimeLimit(json)).toBe(2000);
        check(json, form);

        json = setProgramTimeLimit(json, 1500);
        expect(programTimeLimit(json)).toBe(1500);
        json = setProgramSwitch(json, "timeLimit", true, { onTimeout: "goOn" });
        expect(programTimeoutAction(json)).toBe("goOn");
        expect(programTimeLimit(json)).toBe(1500); // the time is kept
        json = setProgramSwitch(json, "timeLimit", false);
        expect(programSwitchState(json, "timeLimit")).toBe(false);
        expect(ownBlocks(json).some((b) => b.type === "setVariable" && b.var === "MISSES" && b.op === "+")).toBe(false);
        check(json, form);
      });
    }
  }

  it("is mixed when only some presses have it", () => {
    const json = generateProgram({ ...answers("duo"), timeLimit: null }, "repeat");
    const [first] = ownBlocks(json).filter((b) => b.type === "button" || b.type === "remotePress");
    const one = { ...json, blocks: ownBlocks(json).map((b) => (b === first ? { ...b, timeoutMs: 1000 } : b)) };
    expect(programSwitchState(one, "timeLimit")).toBe("mixed");
    expect(programTimeLimit(one)).toBe(1000);
  });

  it("leaves library parts alone: a shipped program built from them has nothing to switch", () => {
    const stern = JSON.parse(DEFAULT_FILES["/prog/stern.json"]!) as ProgramJson;
    expect(programSwitchApplies(stern, "timeLimit")).toBe(false);
    expect(programSwitchApplies(stern, "results")).toBe(false);
    expect(setProgramSwitch(stern, "record", false)).toBe(stern);
    expect(setProgramSwitch(stern, "results", true)).toBe(stern);
  });

  it("adds results at the end of a program without a loop", () => {
    const json: ProgramJson = { name: "One", blocks: [{ name: "On", type: "led", color: "green", next: "Press" }, { name: "Press", type: "button", record: "reaction" }] };
    const next = setProgramSwitch(json, "results", true);
    expect(ownBlocks(next).find((b) => b.name === "Press")!.pressed).toBe("Summary");
    expect(ownBlocks(next).find((b) => b.name === "Summary")).toMatchObject({ type: "summary", metric: "reaction" });
    expect(setProgramSwitch(next, "results", false)).toMatchObject({ blocks: json.blocks });
  });
});
