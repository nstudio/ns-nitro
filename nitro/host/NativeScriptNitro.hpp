#pragma once

namespace nsnitro {

// Installs Nitro (global.NitroModulesProxy and a Dispatcher) into the NativeScript JSI runtime of
// the calling thread. Call it on the JS thread before anything imports nitro-core. Returns false
// when the thread has no JS runtime. Safe to call again, e.g. after an HMR reload.
bool installNitro();

} // namespace nsnitro
