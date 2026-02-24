#pragma once
#include "mod_base.hpp"
#include <functional>
#include <memory>
#include <vector>


namespace Hacks {

class ModuleRegistry {
public:
  using Factory = std::function<IHackModule *()>;

  // Meyers Singleton - guarantees construction order
  static ModuleRegistry &instance() {
    static ModuleRegistry reg;
    return reg;
  }

  void add(Factory f) { factories_.push_back(std::move(f)); }

  std::vector<IHackModule *> getAll() {
    std::vector<IHackModule *> modules;
    for (auto &f : factories_) {
      modules.push_back(f());
    }
    return modules;
  }

private:
  ModuleRegistry() = default;
  std::vector<Factory> factories_;
};

// Helper for static auto-registration
template <typename T> struct AutoRegister {
  AutoRegister() {
    ModuleRegistry::instance().add([]() -> IHackModule * {
      static T instance;
      return &instance;
    });
  }
};

} // namespace Hacks

// Macro for one-liner registration
// We use a unique name for the static variable to avoid collisions
#define REGISTER_HACK(ClassName)                                               \
  static ::Hacks::AutoRegister<ClassName> g_autoReg_##ClassName;
