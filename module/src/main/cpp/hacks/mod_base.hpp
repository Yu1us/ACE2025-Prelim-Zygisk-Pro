#pragma once
#include <cstdint>
#include <string_view>

namespace Hacks {

// ============================================================
// 模块生命周期接口
// [Interview Note] 策略模式 - 方便扩展新功能
// ============================================================
class IHackModule {
public:
  virtual ~IHackModule() = default;

  // 模块名称 (用于日志)
  virtual std::string_view name() const = 0;

  // 初始化 Hook (在 libUE4 加载后调用一次)
  virtual void onLibraryLoaded(uintptr_t base) {}

  // 每轮循环调用 (可用于周期性检查)
  virtual void onTick(uintptr_t pGWorld) {}

  // 找到特定 Actor 时回调
  virtual void onActorFound(uintptr_t actor, std::string_view name) {}
};

} // namespace Hacks
