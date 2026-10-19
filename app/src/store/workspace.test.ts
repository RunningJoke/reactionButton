import { beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "../editor/editorStore";
import { addBlock, newProgram, setBlockField } from "../editor/ops";
import { MemoryStorage } from "./programStore";
import { localFiles, parseProgramText, useWorkspace } from "./workspace";

beforeEach(() => {
  useWorkspace.setState({ loaded: false, programs: [], menu: undefined, sync: null, storage: new MemoryStorage() });
  useEditor.getState().close();
});

describe("workspace", () => {
  it("adds programs with unique paths and keeps them in the storage", async () => {
    const ws = useWorkspace.getState();
    const a = await ws.add(newProgram("Sprint"), "local", { taken: ["/prog/sprint.json"] });
    const b = await ws.add(newProgram("Sprint"), "local");
    expect(a.path).toBe("/prog/sprint-2.json");
    expect(b.path).toBe("/prog/sprint.json");
    expect(await ws.storage.listPrograms()).toHaveLength(2);

    await ws.remove(a.id);
    expect(useWorkspace.getState().programs.map((p) => p.id)).toEqual([b.id]);
    expect(Object.keys(localFiles(useWorkspace.getState().programs))).toEqual(["/prog/sprint.json"]);
  });

  it("keeps the local menu", async () => {
    await useWorkspace.getState().setMenu(["/prog/solo.json"]);
    useWorkspace.setState({ loaded: false, programs: [], menu: undefined });
    await useWorkspace.getState().load();
    expect(useWorkspace.getState().menu).toEqual(["/prog/solo.json"]);
  });

  it("remembers the sync state per set and forgets the menu", async () => {
    const ws = useWorkspace.getState();
    await ws.recordSync("aa", { "/prog/a.json": { crc: "ABCDEF01", size: 3 }, "/prog/b.json": { crc: "1", size: 1 } });
    await ws.recordSync("aa", { "/prog/b.json": null });
    useWorkspace.setState({ sync: null });
    expect(await useWorkspace.getState().loadSync("aa")).toEqual({ setId: "aa", files: { "/prog/a.json": { crc: "abcdef01", size: 3 } } });
    expect((await useWorkspace.getState().loadSync("bb")).files).toEqual({});
    await ws.setMenu(["/prog/a.json"]);
    await ws.setMenu(undefined);
    expect(await ws.storage.getMenu()).toBeUndefined();
  });

  it("rejects imported files that are not programs", () => {
    expect(() => parseProgramText('{"blocks": []}')).toThrow();
    expect(() => parseProgramText("not json")).toThrow();
    expect(parseProgramText('{"name": "X"}')).toEqual({ name: "X" });
  });
});

describe("editor history", () => {
  it("undoes and redoes, saves every step, merges quick typing in one field", async () => {
    const doc = await useWorkspace.getState().add(newProgram("T"), "local");
    const editor = useEditor.getState();
    editor.open(doc);
    const one = addBlock(doc.json, "delay", new Set());
    editor.apply(one.doc);
    editor.apply(setBlockField(one.doc, "Delay1", "ms", 1), { mergeKey: "Delay1.ms" });
    editor.apply(setBlockField(one.doc, "Delay1", "ms", 15), { mergeKey: "Delay1.ms" });
    expect(useEditor.getState().past).toHaveLength(2);

    const saved = () => useWorkspace.getState().programs.find((p) => p.id === doc.id)!.json;
    expect((saved().blocks as { ms: number }[])[0]!.ms).toBe(15);

    useEditor.getState().undo();
    expect((saved().blocks as { ms: number }[])[0]!.ms).toBe(1000);
    useEditor.getState().undo();
    expect(saved().blocks).toEqual([]);
    useEditor.getState().redo();
    expect((saved().blocks as unknown[]).length).toBe(1);
  });
});
