#include "NSNitroInstall.h"

#include <NSNitroModules/NSNitroModulesAutolinking.hpp>

#include "../NativeScriptNitro.hpp"

bool NSNitroInstall(void) {
  margelo::nitro::nsnitro::registerHybridClasses();
  return nsnitro::installNitro();
}
