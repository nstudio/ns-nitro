// swift-tools-version: 6.4

// Builds Nitro Modules (nitro-core), this app's Nitrogen-generated Hybrid Objects and the NativeScript
// host into the `NativeScriptNitro` library, linked via `ios.SPMPackages` in nativescript.config.ts.
// It lives at the app root because SwiftPM only compiles sources inside the package directory, and
// nitro-core's sources are in node_modules. Nitrogen's own `addNitrogenTargets` helper targets React
// Native's package layout, so the targets follow nitro-core's standalone test package instead.

import Foundation
import PackageDescription

let nitroCore = "node_modules/nitro-core/native"
let generated = "nitrogen/generated"

let cxxSettings: [CXXSetting] = [
  .define("DEBUG", .when(configuration: .debug)),
  .define("NDEBUG", .when(configuration: .release)),
  // NativeScriptJSI creates and reads UTF-16 strings natively.
  .define("NITRO_JSI_HAS_FAST_UTF16", to: "true"),
  .disableWarning("nullability-extension"),
]
let swiftSettings: [SwiftSetting] = [
  .swiftLanguageMode(.v6),
  .enableUpcomingFeature("InternalImportsByDefault"),
  .enableUpcomingFeature("MemberImportVisibility"),
  .interoperabilityMode(.Cxx),
  .unsafeFlags(["-Xfrontend", "-clang-header-expose-decls=has-expose-attr-or-stdlib"]),
]
// Swift's generated header is included textually after the C++ declarations it uses.
let swiftBridgeSettings: [CXXSetting] = [
  .unsafeFlags(["-I${GENERATED_MODULEMAP_DIR}", "-fno-modules"])
]

let package = Package(
  name: "NativeScriptNitro",
  platforms: [.iOS(.v16)],
  products: [
    .library(name: "NativeScriptNitro", targets: ["NativeScriptNitro"])
  ],
  dependencies: [
    .package(path: "node_modules/@nativescript/ios-jsi"),
    .package(url: "https://github.com/margelo/simdutf-swift.git", from: "1.0.1", traits: ["UTF8", "UTF16", "ASCII"]),
  ],
  targets: [
    .target(
      name: "NitroModulesCxx",
      dependencies: [.product(name: "NativeScriptJSI", package: "ios-jsi")],
      path: "\(nitroCore)/cpp",
      sources: ["src"],
      publicHeadersPath: "include",
      cxxSettings: cxxSettings
    ),
    .target(
      name: "NitroModulesAppleCxx",
      dependencies: ["NitroModulesCxx"],
      path: "\(nitroCore)/apple",
      sources: ["src"],
      publicHeadersPath: "include",
      cxxSettings: cxxSettings
    ),
    .target(
      name: "NitroModules",
      dependencies: [
        "NitroModulesCxx", "NitroModulesAppleCxx",
        .product(name: "SimdUTF", package: "simdutf-swift"),
      ],
      path: "\(nitroCore)/apple",
      sources: ["core", "utils"],
      cxxSettings: cxxSettings,
      swiftSettings: swiftSettings
    ),
    .target(
      name: "NitroModulesSwiftBridge",
      dependencies: ["NitroModules", "NitroModulesAppleCxx"],
      path: "\(nitroCore)/apple/swift-bridge",
      sources: ["src"],
      publicHeadersPath: "include",
      cxxSettings: cxxSettings + swiftBridgeSettings
    ),

    .target(
      name: "NSNitroModulesCxx",
      dependencies: ["NitroModulesCxx"],
      path: ".",
      exclude: excludes(keeping: ["\(generated)/shared/c++", "nitro/cpp"]),
      sources: ["\(generated)/shared/c++", "nitro/cpp"],
      publicHeadersPath: "\(generated)/shared/c++/include",
      cxxSettings: cxxSettings + [.headerSearchPath("nitro/cpp")]
    ),
    .target(
      name: "NSNitroModulesAppleCxx",
      dependencies: ["NSNitroModulesCxx", "NitroModulesAppleCxx"],
      path: "\(generated)/ios/NSNitroModulesAppleCxx",
      cxxSettings: cxxSettings
    ),
    .target(
      name: "NSNitroModules",
      dependencies: ["NSNitroModulesAppleCxx", "NitroModules"],
      path: ".",
      exclude: excludes(keeping: ["nitro/ios", "\(generated)/ios/swift"]),
      sources: ["nitro/ios", "\(generated)/ios/swift"],
      cxxSettings: cxxSettings,
      swiftSettings: swiftSettings + [
        .unsafeFlags(["-Xfrontend", "-clang-header-expose-module", "-Xfrontend", "NitroModules=NitroModules-Swift.h"])
      ]
    ),
    .target(
      name: "NSNitroModulesSwiftBridge",
      dependencies: ["NSNitroModules", "NSNitroModulesAppleCxx", "NitroModulesSwiftBridge"],
      path: "\(generated)/ios",
      exclude: ["NSNitroModulesAppleCxx", "swift"],
      sources: [
        "c++", "NSNitroModules-Swift-Cxx-Bridge.cpp", "NSNitroModulesAutolinking.cpp", "NSNitroModulesAutolinking.mm",
      ],
      publicHeadersPath: "c++/include",
      cxxSettings: cxxSettings + swiftBridgeSettings + [.headerSearchPath("../../../nitro/cpp")]
    ),

    .target(
      name: "NativeScriptNitro",
      dependencies: [
        "NitroModulesCxx", "NSNitroModulesSwiftBridge",
        .product(name: "NativeScriptJSI", package: "ios-jsi"),
      ],
      path: "nitro/host",
      sources: ["NativeScriptNitro.cpp", "ios"],
      publicHeadersPath: "include",
      cxxSettings: cxxSettings
    ),
  ],
  cxxLanguageStandard: .cxx20
)

// Everything under the package root except `sources` and their parent directories, so targets rooted
// at "." never scan node_modules or platforms.
func excludes(keeping sources: [String]) -> [String] {
  var parents: Set<String> = [""]
  for source in sources {
    var components = source.split(separator: "/").dropLast()
    while !components.isEmpty {
      parents.insert(components.joined(separator: "/"))
      components = components.dropLast()
    }
  }
  let root = URL(fileURLWithPath: Context.packageDirectory)
  var result: [String] = []
  for parent in parents.sorted() {
    let directory = root.appendingPathComponent(parent)
    let entries = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
    for entry in entries.sorted() where !entry.hasPrefix(".") {
      let path = parent.isEmpty ? entry : "\(parent)/\(entry)"
      if !sources.contains(path) && !parents.contains(path) {
        result.append(path)
      }
    }
  }
  return result
}
