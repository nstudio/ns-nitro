import { Utils } from '@nativescript/core';

let selection: UISelectionFeedbackGenerator | null = null;
let impact: UIImpactFeedbackGenerator | null = null;
let impactMedium: UIImpactFeedbackGenerator | null = null;
let impactHeavy: UIImpactFeedbackGenerator | null = null;

function androidFeedback(constant: number): void {
  Utils.android.getCurrentActivity()?.getWindow()?.getDecorView()?.performHapticFeedback(constant);
}

/** Tactile feedback; the simulator and emulator produce none. */
export const haptics = {
  tick(): void {
    if (__APPLE__) {
      (selection ??= UISelectionFeedbackGenerator.new()).selectionChanged();
    } else {
      androidFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK);
    }
  },
  tap(): void {
    if (__APPLE__) {
      (impact ??= UIImpactFeedbackGenerator.alloc().initWithStyle(UIImpactFeedbackStyle.Light)).impactOccurred();
    } else {
      androidFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY);
    }
  },
  Medium(): void {
    if (__APPLE__) {
      (impactMedium ??= UIImpactFeedbackGenerator.alloc().initWithStyle(UIImpactFeedbackStyle.Medium)).impactOccurred();
    } else {
      androidFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP);
    }
  },
  Heavy(): void {
    if (__APPLE__) {
      (impactHeavy ??= UIImpactFeedbackGenerator.alloc().initWithStyle(UIImpactFeedbackStyle.Heavy)).impactOccurred();
    } else {
      androidFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
    }
  },
};

