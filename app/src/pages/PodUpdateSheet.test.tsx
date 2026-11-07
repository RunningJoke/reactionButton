// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "../i18n";
import type { FirmwareImage } from "../pod/firmwareUpdate";
import { closeUpdate, openUpdate, otaTiming, resumeUpdate, useOtaFlow } from "../pod/otaFlow";
import { connectPod, usePodSession } from "../pod/session";
import { SimulatedPod } from "../pod/simulated/SimulatedPod";
import { SimulatedTransport } from "../pod/simulated/SimulatedTransport";
import { secondsLeft, UpdateSheet } from "./PodUpdateSheet";

function makeImage(size = 20_000, version = "2.20.0"): FirmwareImage {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xe9;
  for (let i = 1; i < size; i++) bytes[i] = (i * 31) & 0xff;
  return { version, sha256: createHash("sha256").update(bytes).digest("hex"), size, data: bytes.buffer };
}

const clock = { ms: 1_000_000 };
const realTiming = { ...otaTiming };
let pod: SimulatedPod;

async function setup(options: ConstructorParameters<typeof SimulatedPod>[0] = {}) {
  pod = new SimulatedPod({ firmware: "2.19", clock: () => clock.ms, ...options });
  await connectPod("simulated", { transport: new SimulatedTransport(pod) });
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  clock.ms = 1_000_000;
  // the demo pod restarts at once: time is a number that the waits move
  otaTiming.now = () => clock.ms;
  otaTiming.sleep = async (ms) => void (clock.ms += ms);
  otaTiming.pollMs = 0;
});
afterEach(async () => {
  cleanup();
  closeUpdate();
  Object.assign(otaTiming, realTiming);
  await usePodSession.getState().disconnect();
});

const open = (image = makeImage(), version = "2.20.0") => act(() => openUpdate("2.19", version, async () => image));

describe("the update sheet on the demo pod", () => {
  it("confirm, steps, and the success message", async () => {
    await setup();
    render(<UpdateSheet />);
    open();
    expect(screen.getByText("2.19 to 2.20.0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start update" }));
    await screen.findByText("Updated to 2.20.0. The new firmware runs.", {}, { timeout: 5000 });
    for (const step of ["Preparing the image", "Sending to the pod", "Checking the image", "Restarting the pod", "Checking the new firmware", "Done"]) {
      expect(screen.getByText(step)).toBeTruthy();
    }
    expect(usePodSession.getState().info?.firmware).toBe("2.20.0");
  });

  it("refuses with the reason when the pod is in a game, and the button stays off", async () => {
    await setup();
    pod.state = "RUN";
    await usePodSession.getState().refreshStatus();
    render(<UpdateSheet />);
    open();
    expect(screen.getByText("The pod is in a game. Stop the game and go back to the menu first.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Start update" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses below 30 % battery", async () => {
    await setup();
    pod.selfBatteryMv = 3650;
    await usePodSession.getState().refreshStatus();
    render(<UpdateSheet />);
    open();
    expect(screen.getByText("The battery is below 30 %. Charge the pod first.")).toBeTruthy();
  });

  it("asks for the PIN, and an error code of the pod gets its text", async () => {
    await setup({ pin: "1234" });
    render(<UpdateSheet />);
    open();
    const start = screen.getByRole("button", { name: "Start update" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    pod.otaFailNextVerify = true;
    fireEvent.click(start);
    await screen.findByText("The pod rejected the image. Nothing was changed; try again.", {}, { timeout: 5000 });
    expect(useOtaFlow.getState().phase).toBe("error");
  });

  it("a rollback has its own message", async () => {
    await setup();
    pod.otaSelfTestFails = true;
    render(<UpdateSheet />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Start update" }));
    await screen.findByText(/did not pass its check/, {}, { timeout: 5000 });
    expect(pod.firmware).toBe("2.19");
    // the check failed: it is marked, and "Done" is not ticked
    expect(screen.getByText("Checking the new firmware").closest("li")?.getAttribute("data-state")).toBe("failed");
    expect(screen.getByText("Done").closest("li")?.getAttribute("data-state")).toBe("todo");
  });

  it("tells that only this pod is updated when the central cannot distribute", async () => {
    await setup({ pods: 2, otaDistribute: false });
    render(<UpdateSheet />);
    open();
    expect(screen.getByText(/Only this pod is updated/)).toBeTruthy();
  });

  it("closing during the update asks first; Keep going continues, Stop aborts", async () => {
    await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    render(<UpdateSheet />);
    act(() => openUpdate("2.19", "2.20.0", async () => (await gate, makeImage())));
    fireEvent.click(screen.getByRole("button", { name: "Start update" }));
    await waitFor(() => expect(useOtaFlow.getState().phase).toBe("running"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("Stop the update? The pod keeps its current firmware.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    expect(screen.queryByText("Stop the update? The pod keeps its current firmware.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop update" }));
    expect(useOtaFlow.getState().phase).toBeNull();
    release();
  });
});

describe("the update sheet for a set (#133)", () => {
  // the waits in step 2 must let the page and the test run: real (short) timers, the pod's clock moves with them
  beforeEach(() => {
    otaTiming.sleep = (ms) => new Promise((resolve) => setTimeout(() => ((clock.ms += ms), resolve()), 5));
  });

  it("shows a row per pod, activates by itself and lists what each pod runs", async () => {
    await setup({ pods: 3 });
    render(<UpdateSheet />);
    open();
    expect(screen.getByText(/All pods of the set are updated together/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start update" }));
    await screen.findByText("Updated to 2.20.0. The new firmware runs.", {}, { timeout: 5000 });
    expect(screen.getByText("Step 2: main pod to the other pods")).toBeTruthy();
    expect(screen.getAllByText("Updated to 2.20.0")).toHaveLength(3);
  });

  it("asks what to do when a pod failed; updating only the ready ones ends mixed", async () => {
    await setup({ pods: 3, otaFailingPods: [1] });
    render(<UpdateSheet />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Start update" }));
    await screen.findByText(/2 of 3 pods are ready/, {}, { timeout: 5000 });
    expect(screen.getByText(/Failed, did not receive the update/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update the 2 ready pods" }));
    await screen.findByText(/not every pod does/, {}, { timeout: 5000 });
    expect(screen.getByText("Still on 2.19")).toBeTruthy();
  });

  it("leaving during step 2 can leave the main pod distributing, and it can be picked up again", async () => {
    await setup({ pods: 2, otaMsPerPod: 1_000_000 });
    render(<UpdateSheet />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Start update" }));
    await screen.findByText(/sends the update to the pods one at a time/, {}, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop watching" }));
    expect(useOtaFlow.getState().phase).toBeNull();
    const status = await usePodSession.getState().client!.status();
    expect(status.ota?.pods?.length).toBe(2);
    act(() => resumeUpdate("2.19", "2.20.0"));
    await screen.findByText("Step 2: main pod to the other pods");
  });
});

describe("secondsLeft", () => {
  const flow = { done: 10_240, total: 102_400, startDone: 0, startedAt: 0 };
  it("is hidden until five chunks are through", () => {
    expect(secondsLeft({ ...flow, done: 4 * 2048 }, 1000)).toBeNull();
    expect(secondsLeft({ ...flow, startDone: -1 }, 1000)).toBeNull();
  });
  it("is the rest at the measured rate", () => {
    // 10 240 bytes in 2 s, 92 160 left
    expect(secondsLeft(flow, 2000)).toBe(18);
  });
});
