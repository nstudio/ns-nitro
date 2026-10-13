import { View } from '@nativescript/core';
import { DuoBarEdge, DuoFold, DuoPose, MIN_PANE } from './fold';
import type { HingeListener } from './hinge-tracker';
import { LayoutSensor } from './layout-sensor';

export class HingeTracker {
  private readonly root: WeakRef<View>;
  private hinge: UIHingeInteraction | null = null;
  private sensor: LayoutSensor | null = null;
  private traitRegistration: UITraitChangeRegistration | null = null;

  constructor(
    root: View,
    private readonly listener: HingeListener,
  ) {
    this.root = new WeakRef(root);
    const native = root.nativeViewProtected as UIView | undefined;
    if (!native || typeof UIHingeInteraction === 'undefined') {
      return;
    }

    this.hinge = UIHingeInteraction.alloc().initWithUpdateHandler((_interaction, update) => this.onHinge(update.hinge));
    native.addInteraction(this.hinge);

    this.traitRegistration = native.registerForTraitChangesWithHandler(
      UITraitCollection.systemTraitsAffectingVerticalBarEdge,
      () => this.refresh(),
    );

    // Reserved regions carry no change notification: UIKit expects them to be read during
    // layout and re-runs layout when they change, e.g. as a fold settles after the last
    // hinge update.
    this.sensor = new LayoutSensor(root, () => this.refresh());

    this.refresh();
  }

  dispose(): void {
    const native = this.root.deref()?.nativeViewProtected as UIView | undefined;
    this.sensor?.dispose();
    if (native && this.hinge) {
      native.removeInteraction(this.hinge);
    }
    if (native && this.traitRegistration) {
      native.unregisterForTraitChanges(this.traitRegistration);
    }
    this.sensor = null;
    this.hinge = null;
    this.traitRegistration = null;
  }

  private onHinge(hinge: UIHinge | null): void {
    let pose: DuoPose = 'unknown';
    switch (hinge?.status) {
      case UIHingeStatus.Closed:
        pose = 'closed';
        break;
      case UIHingeStatus.PartiallyOpen:
        pose = 'folded';
        break;
      case UIHingeStatus.FullyOpen:
        pose = 'open';
        break;
    }
    this.listener.onHinge({ supported: !!hinge, pose, angle: hinge ? hinge.angle : null });
    this.refresh();
  }

  private refresh(): void {
    const native = this.root.deref()?.nativeViewProtected as UIView | undefined;
    if (!native) {
      return;
    }
    // Query the sensor (same bounds as the root) so the read happens on the view being laid out.
    const fold = foldWithinNative(this.sensor?.native ?? native);
    const edge = native.traitCollection.verticalBarEdge;
    const barEdge: DuoBarEdge =
      edge === UIVerticalBarEdge.Leading ? 'leading' : edge === UIVerticalBarEdge.Trailing ? 'trailing' : 'none';
    this.listener.onRegions(fold, barEdge);
  }
}

export function foldWithin(view: View): DuoFold | null {
  return foldWithinNative(view?.nativeViewProtected as UIView | undefined);
}

export function trailingOcclusion(view: View): number {
  const native = view?.nativeViewProtected as UIView | undefined;
  if (!native || !native.respondsToSelector('reservedRegionsOfKind:')) {
    return 0;
  }
  const regions = native.reservedRegionsOfKind(UIViewReservedRegionKind.occlusionRegionKind());
  const bounds = native.bounds;
  let inset = 0;
  for (let i = 0; i < regions.count; i++) {
    const region = regions.objectAtIndex(i);
    const frame = region.frame;
    const hugsTrailingEdge = frame.origin.x + frame.size.width >= bounds.size.width - 1;
    if (region.active && hugsTrailingEdge && CGRectIntersectsRect(frame, bounds)) {
      inset = Math.max(inset, bounds.size.width - frame.origin.x);
    }
  }
  return inset;
}

function foldWithinNative(native: UIView | undefined): DuoFold | null {
  if (!native || !native.respondsToSelector('reservedRegionsOfKind:')) {
    return null;
  }
  const regions = native.reservedRegionsOfKind(UIViewReservedRegionKind.divisionRegionKind());
  const bounds = native.bounds;
  for (let i = 0; i < regions.count; i++) {
    const region = regions.objectAtIndex(i);
    if (!region.active || !CGRectIntersectsRect(region.frame, bounds)) {
      continue;
    }
    const { origin, size } = region.frame;
    const axis = size.height >= size.width ? 'vertical' : 'horizontal';
    const before = axis === 'vertical' ? origin.x : origin.y;
    const after =
      axis === 'vertical'
        ? bounds.size.width - (origin.x + size.width)
        : bounds.size.height - (origin.y + size.height);
    if (before < MIN_PANE || after < MIN_PANE) {
      continue;
    }
    return { x: origin.x, y: origin.y, width: size.width, height: size.height, axis };
  }
  return null;
}
