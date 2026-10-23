// Import this before anything that imports nitro-core: nitro-core reads
// globalThis.NitroModulesProxy as soon as it is evaluated.
declare const NSNitroBridge: { installNitro(): boolean };

const installed = __APPLE__
  ? NSNitroBridge.installNitro()
  : org.nativescript.nsnitro.NitroModulesHost.install();
if (!installed) {
  console.error('[nitro] Failed to install Nitro Modules into the NativeScript JS runtime.');
}
