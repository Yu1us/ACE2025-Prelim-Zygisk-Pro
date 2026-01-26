#include "hack_thread.hpp"
#include "game/actor_utils.hpp"
#include "game/offsets.hpp"
#include "hacks/mod_base.hpp"
#include "shadowhook_wrapper.hpp"
#include "utils.hpp"
#include <vector>


// ============================================================
// 模块注册
// ============================================================
namespace Hacks {
extern IHackModule *getModAim();
extern IHackModule *getModSpeed();
extern IHackModule *getModGunOffset();
} // namespace Hacks

static std::vector<Hacks::IHackModule *> g_modules;

void initModules() {
  g_modules.push_back(Hacks::getModAim());
  g_modules.push_back(Hacks::getModSpeed());
  g_modules.push_back(Hacks::getModGunOffset());

  LOGI("[Scheduler] Registered %zu modules", g_modules.size());
  for (auto *mod : g_modules) {
    LOGI("  - %s", mod->name().data());
  }
}

// ============================================================
// 主游戏循环
// ============================================================
void gameLogicLoop(uintptr_t base) {
  // 初始化 GName
  Game::g_GName = base + Game::GName_Offset;
  LOGI("[Scheduler] g_GName = %p", (void *)Game::g_GName);

  // 等待 GWorld
  uintptr_t pGWorld = 0;
  while (true) {
    pGWorld = readPtr(base + Game::GWorld_Offset);
    if (pGWorld != 0) {
      LOGI("[Scheduler] GWorld ready: %p", (void *)pGWorld);
      break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(1000));
  }

  // ============================================================
  // 主循环 - 持续修复
  // [Interview Note] 为什么需要循环？
  // 因为游戏逻辑可能覆盖我们的修改 (Buff/Debuff, Replication等)
  // ============================================================
  while (true) {
    pGWorld = readPtr(base + Game::GWorld_Offset);
    if (pGWorld == 0) {
      std::this_thread::sleep_for(std::chrono::milliseconds(500));
      continue;
    }

    // 遍历 Actor
    auto iter = Game::getActorIterator(pGWorld);
    if (iter) {
      for (auto actor : makeActorSpan(iter->array, iter->count)) {
        if (actor == 0)
          continue;

        auto nameOpt = Game::getName(actor);
        if (!nameOpt)
          continue;

        // 分发给各模块
        for (auto *mod : g_modules) {
          mod->onActorFound(actor, *nameOpt);
        }
      }
    }

    // 各模块 Tick
    for (auto *mod : g_modules) {
      mod->onTick(pGWorld);
    }

    // 防止 CPU 占用过高
    std::this_thread::sleep_for(std::chrono::milliseconds(1000));
  }
}

// ============================================================
// 导出给 main.cpp
// ============================================================
void hack_thread() {
  LOGI("============================================");
  LOGI("[Scheduler] 线程启动，初始化模块...");
  LOGI("============================================");

  // 1. 初始化 ShadowHook
  if (!initShadowHook(SHADOWHOOK_MODE_UNIQUE)) {
    LOGE("[Scheduler] ShadowHook 初始化失败");
    return;
  }

  // 2. 等待 libUE4.so
  uintptr_t base = 0;
  while ((base = getModuleBase("libUE4.so")) == 0) {
    LOGD("[Scheduler] 等待 libUE4.so...");
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
  }
  LOGI("[Scheduler] libUE4.so 基址: %p", (void *)base);

  // 3. 初始化模块
  initModules();

  // 4. 通知各模块 Hook (在 GWorld 之前，尽早安装)
  for (auto *mod : g_modules) {
    mod->onLibraryLoaded(base);
  }

  // 5. 进入主循环
  gameLogicLoop(base);
}
