// iOS 27.1 (iPhone Duo) UIKit declarations missing from @nativescript/types 9.1, copied from
// `ns typings ios` output. Delete this file once the published types include them.

declare const enum UIHingeStatus {
  Unknown = 0,
  Closed = 1,
  PartiallyOpen = 2,
  FullyOpen = 3,
}

declare class UIHinge extends NSObject {
  readonly angle: number;
  readonly status: UIHingeStatus;
}

declare class UIHingeInteractionUpdate extends NSObject {
  readonly hinge: UIHinge | null;
}

declare class UIHingeInteraction extends NSObject implements UIInteraction {
  static alloc(): UIHingeInteraction;
  static new(): UIHingeInteraction;
  enabled: boolean;
  readonly view: UIView | null;
  initWithUpdateHandler(updateHandler: (p1: UIHingeInteraction, p2: UIHingeInteractionUpdate) => void): this;
  didMoveToView(view: UIView | null): void;
  willMoveToView(view: UIView | null): void;
}

declare class UIViewReservedRegionKind extends NSObject {
  static divisionRegionKind(): UIViewReservedRegionKind;
  static occlusionRegionKind(): UIViewReservedRegionKind;
}

declare class UIViewReservedRegionIdentifier extends NSObject {}

declare const enum UIViewReservedRegionQueryOptions {
  None = 0,
  IncludeInactive = 1,
}

declare class UIViewReservedRegion extends NSObject {
  readonly active: boolean;
  readonly frame: CGRect;
  readonly identifier: UIViewReservedRegionIdentifier;
  readonly kind: UIViewReservedRegionKind;
  readonly margins: UIEdgeInsets;
}

interface UIView {
  reservedRegionsOfKind(kind: UIViewReservedRegionKind): NSArray<UIViewReservedRegion>;
  reservedRegionsOfKindOptions(
    kind: UIViewReservedRegionKind,
    options: UIViewReservedRegionQueryOptions,
  ): NSArray<UIViewReservedRegion>;
}

declare const enum UIVerticalBarEdge {
  Unspecified = 0,
  Leading = 1,
  Trailing = 2,
}

declare const enum UIVerticalBarBehavior {
  Automatic = 0,
  Disabled = 1,
}

interface UITraitCollection {
  readonly verticalBarEdge: UIVerticalBarEdge;
}

declare namespace UITraitCollection {
  const systemTraitsAffectingVerticalBarEdge: NSArray<typeof NSObject>;
}

interface UIViewController {
  readonly arrangementViewController: UIArrangementViewController | null;
  readonly preferredVerticalBarBehavior: UIVerticalBarBehavior;
}

declare const enum UISheetPresentationControllerPlacement {
  Automatic = 0,
  Leading = 1,
  Center = 2,
  Trailing = 3,
}

interface UISheetPresentationController {
  preferredPlacement: UISheetPresentationControllerPlacement;
}

// From UIUtilities, which the default @nativescript/types index doesn't load.
declare const enum UIAxis {
  Neither = 0,
  Horizontal = 1,
  Vertical = 2,
  Both = 3,
}

declare const enum UIArrangementViewControllerViewPlacement {
  None = 0,
  Primary = 1,
  Secondary = 2,
}

declare class UIArrangement extends NSObject {}

declare class UISplitArrangementDimension extends NSObject {
  static absoluteDimension(absoluteValue: number): UISplitArrangementDimension;
  static automaticDimension(): UISplitArrangementDimension;
  static fractionalDimension(fraction: number): UISplitArrangementDimension;
  static intrinsicDimension(): UISplitArrangementDimension;
}

declare class UISplitArrangementDimensionRange extends NSObject {
  static alloc(): UISplitArrangementDimensionRange;
  static new(): UISplitArrangementDimensionRange;
  maximum: UISplitArrangementDimension;
  minimum: UISplitArrangementDimension;
  preferred: UISplitArrangementDimension;
}

declare class UISplitArrangementViewProperties extends NSObject {
  static alloc(): UISplitArrangementViewProperties;
  static new(): UISplitArrangementViewProperties;
  height: UISplitArrangementDimensionRange;
  layoutPriority: number;
  width: UISplitArrangementDimensionRange;
}

declare class UISplitArrangement extends UIArrangement {
  static splitArrangement(): UISplitArrangement;
  axes: UIAxis;
  readonly defaultViewProperties: UISplitArrangementViewProperties;
  setViewPropertiesForPlacement(
    viewProperties: UISplitArrangementViewProperties,
    placement: UIArrangementViewControllerViewPlacement,
  ): void;
}

declare class UIOverlayArrangementViewProperties extends NSObject {
  edge: NSDirectionalRectEdge;
}

declare class UIOverlayArrangement extends UIArrangement {
  static overlayArrangement(): UIOverlayArrangement;
  axes: UIAxis;
  readonly defaultViewProperties: UIOverlayArrangementViewProperties;
  setViewPropertiesForPlacement(
    viewProperties: UIOverlayArrangementViewProperties,
    placement: UIArrangementViewControllerViewPlacement,
  ): void;
}

declare class UIArrangementViewState extends NSObject {
  readonly hidden: boolean;
  readonly splitAxis: UIAxis;
  readonly zIndex: number;
}

declare class UIArrangementViewController extends UIViewController {
  static alloc(): UIArrangementViewController;
  static new(): UIArrangementViewController;
  placementForViewController(viewController: UIViewController): UIArrangementViewControllerViewPlacement;
  setViewControllerForPlacement(
    viewController: UIViewController | null,
    placement: UIArrangementViewControllerViewPlacement,
  ): void;
  setViewControllerForPlacementAnimated(
    viewController: UIViewController | null,
    placement: UIArrangementViewControllerViewPlacement,
    animated: boolean,
  ): void;
  stateForPlacement(placement: UIArrangementViewControllerViewPlacement): UIArrangementViewState | null;
  updateArrangement(arrangement: UIArrangement): void;
  updateArrangementAnimated(arrangement: UIArrangement, animated: boolean): void;
  viewControllerForPlacement(placement: UIArrangementViewControllerViewPlacement): UIViewController | null;
}
