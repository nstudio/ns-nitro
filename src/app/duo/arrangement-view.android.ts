import { ArrangementViewBase, PaneSplit } from './arrangement-view.common';
import { foldWithin } from './hinge-tracker';

export * from './arrangement-view.common';

/** Divides the panes at the fold when one crosses the view, so neither straddles the hinge. */
export class ArrangementView extends ArrangementViewBase {
  protected divide(width: number, height: number): PaneSplit | null {
    const fold = this.secondary ? foldWithin(this) : null;
    if (fold?.axis === 'vertical' && this.axes !== 'vertical') {
      return { direction: 'horizontal', start: fold.x, end: fold.x + fold.width };
    }
    if (fold?.axis === 'horizontal' && this.axes !== 'horizontal') {
      return { direction: 'vertical', start: fold.y, end: fold.y + fold.height };
    }
    return super.divide(width, height);
  }
}
