// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { MemoryStorage, type ProgramDoc } from "../store/programStore";
import { useWorkspace } from "../store/workspace";
import { usePodSession } from "./session";
import { useMenuOverBudget } from "./syncActions";

afterEach(() => {
  cleanup();
  useWorkspace.setState({ programs: [], menu: undefined, storage: new MemoryStorage() });
  usePodSession.setState({ list: null, files: {} });
});

/** A local program whose file is about `chars` bytes long. */
const program = (path: string, chars: number): ProgramDoc => ({
  id: path,
  path,
  json: { name: path, description: "x".repeat(chars) },
  origin: "local",
  updatedAt: 0,
});

describe("useMenuOverBudget (#121)", () => {
  it("is not over with a small menu, and is over when the menu's files pass the store budget", () => {
    usePodSession.setState({ list: { menu: [], files: [] } as never, files: {} });
    useWorkspace.setState({ programs: [program("/prog/a.json", 100)], menu: ["/prog/a.json"] });
    expect(renderHook(() => useMenuOverBudget()).result.current).toBe(false);

    useWorkspace.setState({
      programs: [program("/prog/a.json", 100_000), program("/prog/b.json", 60_000)],
      menu: ["/prog/a.json", "/prog/b.json"],
    });
    expect(renderHook(() => useMenuOverBudget()).result.current).toBe(true);
  });

  it("uses the pod's menu and files when the local menu follows the pod", () => {
    usePodSession.setState({ list: { menu: ["/prog/c.json"], files: [] } as never, files: { "/prog/c.json": "x".repeat(150_000) } });
    useWorkspace.setState({ programs: [], menu: undefined });
    expect(renderHook(() => useMenuOverBudget()).result.current).toBe(true);
  });
});
