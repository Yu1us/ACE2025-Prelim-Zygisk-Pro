#include "../game/offsets.hpp"
#include "../shadowhook_wrapper.hpp"
#include "../utils.hpp"
#include "mod_base.hpp"
#include "registry.hpp"

namespace Hacks {

// ============================================================
// 全局状态
// ============================================================
static uintptr_t g_PlayerController = 0;
static void *g_stub_spawn = nullptr;
static void *(*orig_SpawnProjectile)(void *, void *, void *, void *, void *,
                                     void *) = nullptr;

// ============================================================
// Hook 回调
// ============================================================
void *HOOK_SpawnProjectile(void *thisPtr, void *projectileClass,
                           Game::FVector *spawnLocation,
                           Game::FRotator *spawnRotation, void *owner,
                           void *instigator) {
  /* 🛑 填空题: Aimbot Hook 逻辑
     参考: _reference/hacks.cpp.bak:110-131

     步骤:
     1. rotationPtr = arg3 (这是 FRotator* 指针)
     2. 判断条件: if (g_PlayerController != 0 && rotationPtr != nullptr)
     3. 读取玩家视角:
        - ctrlRotPtr = g_PlayerController + Controller_ControlRotation (0x288)
        - pitch = readFloat(ctrlRotPtr)
        - yaw = readFloat(ctrlRotPtr + 4)
     4. 强制修正子弹角度:
        - writeFloat((uintptr_t)rotationPtr, pitch)
        - writeFloat((uintptr_t)rotationPtr + 4, yaw)
     5. (填空结束后) 调用原函数已在下方实现

     预期效果: 子弹发射方向始终与玩家视角同步

     可用常量:
     - Game::Controller_ControlRotation = 0x288
  */

  // YOUR CODE HERE
  if (g_PlayerController && spawnLocation && spawnRotation) {
    // spawnLocation->z += 10.0f;
    // 起始位置还是有问题

    auto ctrlRotPtr = reinterpret_cast<Game::FRotator *>(
        g_PlayerController + Game::Controller_ControlRotation);
    if (ctrlRotPtr) {
      *spawnRotation = *ctrlRotPtr;
    }
  }

  // 调用原函数 (这部分不用改)
  if (orig_SpawnProjectile) {
    return orig_SpawnProjectile(thisPtr, projectileClass, (void *)spawnLocation,
                                (void *)spawnRotation, owner, instigator);
  }
  return nullptr;
}

// ============================================================
// 模块类
// ============================================================
class ModProjectile : public IHackModule {
public:
  std::string_view name() const override { return "ProjectileFix"; }

  void onLibraryLoaded(uintptr_t base) override {
    uintptr_t targetAddr = base + Game::SpawnProjectile_Func_Offset;
    LOGI("[%s] Hooking SpawnProjectile @ %p", name().data(),
         (void *)targetAddr);

    g_stub_spawn = shadowhook_hook_func_addr((void *)targetAddr,
                                             (void *)HOOK_SpawnProjectile,
                                             (void **)&orig_SpawnProjectile);

    if (g_stub_spawn == nullptr) {
      LOGE("[%s] Hook failed: %s", name().data(),
           shadowhook_to_errmsg(shadowhook_get_errno()));
    } else {
      LOGI("[%s] Hook installed successfully", name().data());
    }
  }

  void onActorFound(uintptr_t actor, std::string_view actorName) override {
    if (actorName.find("PlayerController") != std::string_view::npos) {
      g_PlayerController = actor;
      LOGD("[%s] Found PlayerController @ %p", name().data(), (void *)actor);
    }
  }
};

REGISTER_HACK(ModProjectile)

} // namespace Hacks
