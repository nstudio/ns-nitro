#pragma once

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

// Installs Nitro into the calling thread's NativeScript JS runtime and registers this app's Hybrid
// Objects. Call it on the JS thread before anything imports nitro-core.
bool NSNitroInstall(void);

#ifdef __cplusplus
}
#endif
