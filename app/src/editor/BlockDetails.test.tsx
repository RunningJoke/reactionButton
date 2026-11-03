// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "../i18n";
import type { GraphNode } from "../model/graph";
import { BlockDetailsSheet } from "./BlockDetails";

const node: GraphNode = { id: "Hold", block: { name: "Hold", type: "delay", ms: 500 }, file: "/prog/lib/loop.json", own: false, start: false, ends: false, unreachable: false, external: false, ports: [], fallbackPorts: [] };

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

it("a step of a shared game piece: the way to change it is a button, raw fields stay folded", () => {
  const flatten = vi.fn();
  render(<BlockDetailsSheet node={node} known={new Set(["Hold"])} onSelect={() => {}} onFlatten={flatten} />);
  fireEvent.click(screen.getByRole("button", { name: "Make all steps editable" }));
  expect(flatten).toHaveBeenCalled();
  expect(screen.getByText("Show details").closest("details")?.open).toBe(false);
  expect(document.body.textContent).not.toMatch(/library part|fragment|flatten/i);
});

it("an own step has no convert button", () => {
  render(<BlockDetailsSheet node={{ ...node, own: true }} known={new Set()} onSelect={() => {}} onFlatten={() => {}} />);
  expect(screen.queryByRole("button", { name: "Make all steps editable" })).toBeNull();
});
