import { Application, View } from '@nativescript/core';
import { foldWithin } from './hinge-tracker';

/** Same clearance the stage keeps: a fold reported as a bare line still gets real width. */
const FOLD_GAP = 40;
const FLAT_SEAM_GAP = 20;
const SPLIT_MIN_WIDTH = 600;

/** Two panes either side of a vertical fold, in the host view's dips. */
export interface FoldPanes {
  /** GridLayout columns for the host: left pane, the gap over the fold, right pane. */
  columns: string;
}

/**
 * Splits `host` at the fold so no row runs across the hinge. A flat device reports no fold,
 * so a wide window splits at its center instead, where the hinge still is.
 */
export function foldPanes(host: View): FoldPanes | null {
  const width = host.getActualSize().width;
  if (width < SPLIT_MIN_WIDTH) {
    return null;
  }
  let start: number;
  let length: number;
  const fold = foldWithin(host);
  if (fold) {
    if (fold.axis !== 'vertical') {
      return null;
    }
    [start, length] = [fold.x, fold.width];
  } else {
    const root = Application.getRootView();
    const center = root ? root.getActualSize().width / 2 - host.getLocationRelativeTo(root).x : width / 2;
    [start, length] = [center, 0];
  }
  const minGap = fold || width >= 760 ? FOLD_GAP : FLAT_SEAM_GAP;
  if (length < minGap) {
    start -= (minGap - length) / 2;
    length = minGap;
  }
  return { columns: `${Math.round(start)}, ${Math.round(length)}, *` };
}

/** Splits `items` into two runs whose `weight`s are as even as the order allows. */
export function balance<T>(items: readonly T[], weight: (item: T) => number): [T[], T[]] {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let running = 0;
  let cut = items.length;
  for (let i = 0; i < items.length; i++) {
    const next = running + weight(items[i]);
    if (next > total / 2) {
      cut = next - total / 2 <= total / 2 - running ? i + 1 : i;
      break;
    }
    running = next;
  }
  return [items.slice(0, cut), items.slice(cut)];
}
