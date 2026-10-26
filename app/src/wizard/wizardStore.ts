/**
 * The wizard in progress. Kept in memory while the app runs, so "Try it" or "Change steps" and
 * the way back land on the same answers, and a second "Try it" updates the same program.
 */
import { create } from "zustand";
import { defaultAnswers, normalizeAnswers, type WizardAnswers } from "./answers";

/** 0 game, 1 pods, 2 rounds and timing, 3 colours, 4 measure, 5 ready */
export const WIZARD_STEPS = ["game", "pods", "timing", "colors", "measure"] as const;
export const READY_STEP = WIZARD_STEPS.length;

export const DEFAULT_PODS = 3;

/** Route of the wizard (inside Programs). */
export const WIZARD_PATH = "/programs/new";

type WizardState = {
  answers: WizardAnswers;
  step: number;
  /** the local program saved from these answers (Try it, Change steps) */
  savedId: string | null;
  start: () => void;
  update: (change: (a: WizardAnswers) => WizardAnswers) => void;
  setStep: (step: number) => void;
  setSavedId: (id: string | null) => void;
};

export const useWizard = create<WizardState>((set) => ({
  answers: defaultAnswers("star", DEFAULT_PODS),
  step: 0,
  savedId: null,
  start: () => set((s) => ({ answers: defaultAnswers(s.answers.game, s.answers.pods), step: 0, savedId: null })),
  update: (change) => set((s) => ({ answers: normalizeAnswers(change(s.answers)) })),
  setStep: (step) => set({ step: Math.max(0, Math.min(READY_STEP, step)) }),
  setSavedId: (savedId) => set({ savedId }),
}));
