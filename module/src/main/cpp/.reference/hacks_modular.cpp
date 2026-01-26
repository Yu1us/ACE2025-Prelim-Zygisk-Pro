#include "game.hpp"
#include "hacks/mod_base.hpp"
#include "utils.hpp"
#include <cstring>
#include <vector>

// 声明外部模块获取函数
namespace Hacks {
IHackModule *getModSpeed();
IHackModule *getModAim();
IHackModule *getModGunOffset();
} // namespace Hacks

// ============================================
// 核心逻辑区域 (Red Zone)
// 这里是你要「填空」练习的地方
// ============================================

// 全局变量保存
uintptr_t g_GName = 0;

// [Interview Trap] FName 的解密算法是各大厂面试常考题
// 这里你需要根据 JS 里的 getName 手写 C++ 版本
std::optional<std::string> getName(uintptr_t objAddr) {
  if (objAddr == 0 || g_GName == 0)
    return std::nullopt;

  /* 🛑 填空题: 实现 FName 解析逻辑
     提示: 参考 solve_aim.js:16-32
     步骤:
     1. 从 objAddr + 0x18 读取 fNameId
     2. 计算 block = fNameId >> 16, offset = fNameId & 0xFFFF
     3. 从 GName + 0x30 获取 fNamePool
     4. 读取 chunk = fNamePool + 0x10 + block * 8
     5. 计算 entry = chunk + 2 * offset
     6. 读取 header 并解析 len = header >> 6
     7. 从 entry + 2 读取 len 个字符作为名称
  */
  // ============================================================
  // Step 1: 读取 FName Index (UObject 的 NamePrivate 成员)
  // ============================================================
  constexpr uintptr_t kUObject_NamePrivate_Offset = 0x18;
  auto fNameId = readU32(objAddr + kUObject_NamePrivate_Offset);

  // ============================================================
  // Step 2: 从 FNameEntryId 中解析 Block 和 Offset
  // ============================================================
  auto block = fNameId >> 16;     // 高 16 位: chunk 索引
  auto offset = fNameId & 0xFFFF; // 低 16 位: chunk 内偏移

  // ============================================================
  // Step 3: 定位 FNamePool
  // ============================================================
  constexpr uintptr_t kFNamePool_Entries_Offset = 0x10;
  auto fNamePool = g_GName + 0x30; // 真正的 FNamePool 基址

  // ============================================================
  // Step 4: 读取 Chunk 指针并计算 Entry 地址
  // ============================================================
  auto chunk = readPtr(fNamePool + kFNamePool_Entries_Offset + block * 8);
  constexpr uintptr_t kFNameEntry_Stride = 2;
  auto entry = chunk + kFNameEntry_Stride * offset;

  // ============================================================
  // Step 5: 解析 FNameEntry Header 获取字符串长度
  // ============================================================
  constexpr uint16_t kFNameEntry_LenShift = 6; // 长度存储在高 10 位
  auto header = readU16(entry);
  auto len = header >> kFNameEntry_LenShift;

  if (len > 0 && len < 100) {
    constexpr uintptr_t kFNameEntry_Data_Offset = 2;
    return std::string(
        reinterpret_cast<char *>(entry + kFNameEntry_Data_Offset), len);
  }

  return std::nullopt;
}

#include "shadowhook_wrapper.hpp"

// 主循环：等待 GWorld 初始化并遍历 Actor
// 对应 JS: onReady / waitForGWorld
void gameLogicLoop(uintptr_t base,
                   const std::vector<Hacks::IHackModule *> &modules) {
  // 初始化 GName
  g_GName = base + Game::GName_Offset;

  uintptr_t pGWorld = 0;
  // 轮询等待游戏世界对象初始化，避免访问空指针
  while (true) {
    pGWorld = readPtr(base + Game::GWorld_Offset);

    if (pGWorld != 0) {
      LOGI("GWorld initialized: %p", (void *)pGWorld);
      break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(1000));
  }

  // 遍历 Actor (Level -> ActorsArray)
  // See solve_aim.js:65-95
  auto level = readPtr(pGWorld + 0x30);
  auto actorsArray = readPtr(level + 0x98);
  auto actorsCount = readU32(level + 0x98 + 8);

  // 通知所有模块 Tick
  for (auto mod : modules) {
    mod->onTick(pGWorld);
  }

  // 使用 std::span 遍历 Actor 数组
  for (auto actor : makeActorSpan(actorsArray, actorsCount)) {
    if (actor == 0)
      continue;

    auto nameOpt = getName(actor);
    if (!nameOpt)
      continue;
    const auto &name = *nameOpt;

    // 分发给所有 registered modules
    for (auto mod : modules) {
      mod->onActorFound(actor, name);
    }
  }
}

// 导出给 main.cpp 调用的入口
void hack_thread() {
  LOGI("============================================");
  LOGI("[Zygisk] 模块化系统启动...");
  LOGI("============================================");

  // 注册模块列表
  // 这里是你添加新功能的地方
  std::vector<Hacks::IHackModule *> modules;
  modules.push_back(Hacks::getModSpeed()); // <--- 这里的 mod_speed.cpp 等你填空
  modules.push_back(Hacks::getModAim());   // <--- 这里的 mod_aim.cpp 等你填空
  modules.push_back(
      Hacks::getModGunOffset()); // <--- 这里的 mod_gunoffset.cpp 等你填空

  // 初始化 ShadowHook
  if (!initShadowHook(SHADOWHOOK_MODE_UNIQUE)) {
    LOGE("[!] ShadowHook 初始化失败，无法继续");
    return;
  }

  uintptr_t base = 0;
  while ((base = getModuleBase("libUE4.so")) == 0) {
    LOGD("[*] 正在检索 libUE4.so 基址...");
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
  }

  LOGI("[*] 成功定位 libUE4.so 基址: %p", (void *)base);

  // 1. Module LibraryLoaded 回调 (安装 HOOK)
  for (auto mod : modules) {
    LOGI("[*] Loading module: %s", mod->name().data());
    mod->onLibraryLoaded(base);
  }

  // 2. 运行游戏逻辑循环
  while (true) {
    gameLogicLoop(base, modules);
    // 简单休眠防止占用过高，实际逻辑在 loop 内的 sleep 或者 loop
    // 本身如果是单次调用需要修改 原来的 logic loop 并不是 while(true) loop,
    // wait... 原来的 logic loop 是单次执行遍历。我们需要让它持续运行吗？ 这是个
    // Hack 线程，通常是一个死循环。 先让它每秒扫一次吧
    std::this_thread::sleep_for(std::chrono::milliseconds(
        100)); // 10 ticks/s is enough for actor iteration
  }
}
