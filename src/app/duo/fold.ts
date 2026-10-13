export type DuoPose = 'unknown' | 'closed' | 'folded' | 'open';
export type DuoBarEdge = 'none' | 'leading' | 'trailing';

/** A folding region in dips, in the coordinate space of the view it was queried on. */
export interface DuoFold {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 'vertical' splits the view into left/right halves, 'horizontal' into top/bottom. */
  axis: 'vertical' | 'horizontal';
}

/** A fold hugging the view's edge leaves nothing to lay out on one side of it. */
export const MIN_PANE = 120;
