import { Utils, View } from '@nativescript/core';
import { IOSHelper } from '@nativescript/core/ui/core/view/view-helper';
import { ArrangementViewBase, axesProperty, primaryFractionProperty } from './arrangement-view.common';

export * from './arrangement-view.common';

/**
 * Hosts one pane. Core's UILayoutViewController isn't used because it copies an ancestor's top
 * safe-area inset onto itself (a TabView accommodation), which pads panes that sit below a fold.
 */
@NativeClass()
class ArrangementPaneController extends UIViewController {
  private owner: WeakRef<View>;

  static initWithOwner(owner: WeakRef<View>): ArrangementPaneController {
    const controller = ArrangementPaneController.new() as ArrangementPaneController;
    controller.owner = owner;
    return controller;
  }

  viewDidLayoutSubviews(): void {
    super.viewDidLayoutSubviews();
    const owner = this.owner?.deref();
    if (owner) {
      IOSHelper.layoutView(this, owner);
    }
  }

  viewSafeAreaInsetsDidChange(): void {
    super.viewSafeAreaInsetsDidChange();
    this.view.setNeedsLayout();
  }
}

/**
 * Backed by UIArrangementViewController (iOS 27.1+), so the system moves the panes around
 * reserved regions such as the iPhone Duo fold. Falls back to the base layout on older iOS.
 */
export class ArrangementView extends ArrangementViewBase {
  private controller: UIArrangementViewController | null = null;
  private hosts = new Map<View, UIViewController>();

  get secondaryVisible(): boolean {
    if (!this.controller) {
      return super.secondaryVisible;
    }
    // The reported state can read "not hidden" while the pane is detached (outer display), so
    // also require the pane to actually be in a window.
    const state = this.controller.stateForPlacement(UIArrangementViewControllerViewPlacement.Secondary);
    const host = this.secondary && this.hosts.get(this.secondary);
    return !!state && !state.hidden && !!host?.viewIfLoaded?.window;
  }

  createNativeView(): UIView {
    const container = UIView.new();
    if (typeof UIArrangementViewController !== 'undefined') {
      this.controller = UIArrangementViewController.new();
      const arranged = this.controller.view;
      arranged.backgroundColor = UIColor.clearColor;
      arranged.frame = container.bounds;
      arranged.autoresizingMask = UIViewAutoresizing.FlexibleWidth | UIViewAutoresizing.FlexibleHeight;
      container.addSubview(arranged);
    }
    return container;
  }

  initNativeView(): void {
    super.initNativeView();
    this.applyArrangement(false);
  }

  disposeNativeView(): void {
    this.controller = null;
    this.hosts.clear();
    super.disposeNativeView();
  }

  onLoaded(): void {
    super.onLoaded();
    const parent = this.page?.viewController as UIViewController | undefined;
    if (this.controller && parent && this.controller.parentViewController !== parent) {
      parent.addChildViewController(this.controller);
      this.controller.didMoveToParentViewController(parent);
    }
  }

  onUnloaded(): void {
    if (this.controller?.parentViewController) {
      this.controller.willMoveToParentViewController(null);
      this.controller.removeFromParentViewController();
    }
    super.onUnloaded();
  }

  onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    if (!this.controller) {
      super.onMeasure(widthMeasureSpec, heightMeasureSpec);
      return;
    }
    // Panes are measured by their hosting controllers once UIKit has placed them.
    this.setMeasuredDimension(
      Utils.layout.getMeasureSpecSize(widthMeasureSpec),
      Utils.layout.getMeasureSpecSize(heightMeasureSpec),
    );
  }

  onLayout(left: number, top: number, right: number, bottom: number): void {
    if (!this.controller) {
      super.onLayout(left, top, right, bottom);
    }
  }

  _addViewToNativeVisualTree(child: View, atIndex?: number): boolean {
    if (!this.controller) {
      return super._addViewToNativeVisualTree(child, atIndex);
    }
    const host = ArrangementPaneController.initWithOwner(new WeakRef(child));
    host.view.backgroundColor = UIColor.clearColor;
    host.view.addSubview(child.nativeViewProtected);
    child.viewController = host;
    this.hosts.set(child, host);
    this.syncPlacements();
    return true;
  }

  _removeViewFromNativeVisualTree(child: View): void {
    const host = this.hosts.get(child);
    if (this.controller && host) {
      const placement = this.controller.placementForViewController(host);
      if (placement !== UIArrangementViewControllerViewPlacement.None) {
        this.controller.setViewControllerForPlacement(null, placement);
      }
      this.hosts.delete(child);
      child.viewController = undefined;
    }
    super._removeViewFromNativeVisualTree(child);
    this.syncPlacements();
  }

  [axesProperty.setNative](): void {
    this.applyArrangement(true);
  }

  [primaryFractionProperty.setNative](): void {
    this.applyArrangement(true);
  }

  private syncPlacements(): void {
    if (!this.controller) {
      return;
    }
    const placements = [
      UIArrangementViewControllerViewPlacement.Primary,
      UIArrangementViewControllerViewPlacement.Secondary,
    ];
    placements.forEach((placement, index) => {
      const child = this.getChildAt(index);
      const host = (child && this.hosts.get(child)) ?? null;
      if (this.controller.viewControllerForPlacement(placement) !== host) {
        this.controller.setViewControllerForPlacement(host, placement);
      }
    });
  }

  private applyArrangement(animated: boolean): void {
    if (!this.controller) {
      return;
    }
    const arrangement = UISplitArrangement.splitArrangement();
    arrangement.axes =
      this.axes === 'horizontal' ? UIAxis.Horizontal : this.axes === 'vertical' ? UIAxis.Vertical : UIAxis.Both;

    if (this.primaryFraction > 0 && this.primaryFraction < 1) {
      const range = UISplitArrangementDimensionRange.new();
      range.preferred = UISplitArrangementDimension.fractionalDimension(this.primaryFraction);
      const properties = UISplitArrangementViewProperties.new();
      properties.width = range;
      properties.height = range;
      arrangement.setViewPropertiesForPlacement(properties, UIArrangementViewControllerViewPlacement.Primary);
    }
    this.controller.updateArrangementAnimated(arrangement, animated);
  }
}
