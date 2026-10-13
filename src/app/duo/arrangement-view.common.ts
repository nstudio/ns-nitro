import { LayoutBase, Property, Utils, View } from '@nativescript/core';

export type ArrangementAxes = 'both' | 'horizontal' | 'vertical';

export const axesProperty = new Property<ArrangementViewBase, ArrangementAxes>({
  name: 'axes',
  defaultValue: 'both',
});

/** Share of the split axis given to the primary view, 0-1. 0 lets the system decide. */
export const primaryFractionProperty = new Property<ArrangementViewBase, number>({
  name: 'primaryFraction',
  defaultValue: 0,
  valueConverter: (v) => parseFloat(v),
});

export interface PaneSplit {
  /** 'horizontal' places the panes side by side, 'vertical' stacks them. */
  direction: 'horizontal' | 'vertical';
  /** Along the split axis: where the primary pane ends, and where the secondary begins. */
  start: number;
  end: number;
}

/**
 * Two-pane container: the first child is the primary view, the second the secondary view.
 * Panes sit side by side when wider than tall, stacked when taller than wide, and only the
 * primary shows when that axis is excluded by `axes`.
 *
 * Must fill its parent: don't nest it in a ScrollView, ListView or auto-sized row.
 */
export abstract class ArrangementViewBase extends LayoutBase {
  axes: ArrangementAxes;
  primaryFraction: number;

  private split: PaneSplit | null = null;

  get primary(): View | undefined {
    return this.getChildAt(0);
  }

  get secondary(): View | undefined {
    return this.getChildAt(1);
  }

  /** Whether the secondary view is on screen right now. */
  get secondaryVisible(): boolean {
    return !!this.secondary && this.split !== null;
  }

  onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const width = Utils.layout.getMeasureSpecSize(widthMeasureSpec);
    const height = Utils.layout.getMeasureSpecSize(heightMeasureSpec);
    this.setMeasuredDimension(width, height);

    this.split = this.divide(width, height);
    const [primaryRect, secondaryRect] = this.rects(width, height);
    this.measurePane(this.primary, primaryRect);
    this.measurePane(this.secondary, secondaryRect);
  }

  onLayout(left: number, top: number, right: number, bottom: number): void {
    const [primaryRect, secondaryRect] = this.rects(right - left, bottom - top);
    this.layoutPane(this.primary, primaryRect);
    this.layoutPane(this.secondary, secondaryRect);
  }

  /** How a `width` by `height` area is divided between the panes; null shows only the primary. */
  protected divide(width: number, height: number): PaneSplit | null {
    if (!this.secondary) {
      return null;
    }
    const fraction = this.primaryFraction > 0 && this.primaryFraction < 1 ? this.primaryFraction : 0.5;
    if (width > height && this.axes !== 'vertical') {
      const x = Math.round(width * fraction);
      return { direction: 'horizontal', start: x, end: x };
    }
    if (width <= height && this.axes !== 'horizontal') {
      const y = Math.round(height * fraction);
      return { direction: 'vertical', start: y, end: y };
    }
    return null;
  }

  private rects(width: number, height: number): [number[], number[]] {
    const split = this.split;
    if (split?.direction === 'horizontal') {
      return [
        [0, 0, split.start, height],
        [split.end, 0, width, height],
      ];
    }
    if (split?.direction === 'vertical') {
      return [
        [0, 0, width, split.start],
        [0, split.end, width, height],
      ];
    }
    return [
      [0, 0, width, height],
      [0, 0, 0, 0],
    ];
  }

  private measurePane(pane: View | undefined, [l, t, r, b]: number[]): void {
    if (pane) {
      View.measureChild(
        this,
        pane,
        Utils.layout.makeMeasureSpec(r - l, Utils.layout.EXACTLY),
        Utils.layout.makeMeasureSpec(b - t, Utils.layout.EXACTLY),
      );
    }
  }

  private layoutPane(pane: View | undefined, [l, t, r, b]: number[]): void {
    if (pane) {
      View.layoutChild(this, pane, l, t, r, b);
    }
  }
}

axesProperty.register(ArrangementViewBase);
primaryFractionProperty.register(ArrangementViewBase);
