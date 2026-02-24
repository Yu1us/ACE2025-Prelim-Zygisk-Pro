/**
 * @file mod_aim.cpp
 * @brief Aimbot 修复 - NOP Patch
 *
 * 目标: 禁用自动瞄准逻辑 (SetControlRotation 调用)
 * 参考: scripts/solve_aim.js
 */

#include <cstdint>
#include <cstring>
#include <sys/mman.h>
#include <unistd.h>

#include "../game/offsets.hpp"
#include "../utils.hpp"
#include "mod_base.hpp"
#include "registry.hpp"

// ==================== 常量偏移 ====================
// ==================== 常量偏移 ====================
// Offsets moved to game/offsets.hpp
// ARM64 constants moved to utils.cpp

// ==================== 工具函数 ====================
// set_memory_protection moved to utils.hpp

namespace Hacks {

class ModAim : public IHackModule {
public:
  std::string_view name() const override { return "AimFix"; }

  void onLibraryLoaded(uintptr_t lib_base) override {
    LOGI("[mod_aim] Applying aimbot fix...");

    uintptr_t patch_addr = lib_base + Game::AimbotPatch;
    LOGI("[mod_aim] Patch target: 0x%lX", patch_addr);

    if (set_memory_protection(reinterpret_cast<void *>(patch_addr), 4,
                              PROT_READ | PROT_WRITE | PROT_EXEC)) {
      LOGE("[mod_aim] Failed to set memory protection!");
      return;
    }

    std::memcpy(reinterpret_cast<void *>(patch_addr), ARM64_NOP,
                sizeof(ARM64_NOP));

    LOGI("[mod_aim] ✓ Aimbot fix applied successfully!");
  }
};

REGISTER_HACK(ModAim)

} // namespace Hacks
