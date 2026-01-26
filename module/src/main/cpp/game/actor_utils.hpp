#pragma once
#include "../utils.hpp"
#include "offsets.hpp"
#include <optional>
#include <string>
#include <string_view>

namespace Game {

// 全局 GName 基址 (由 hack_thread 初始化)
inline uintptr_t g_GName = 0;

// ============================================================
// FName 解析
// [Interview Trap] FName 的解密算法是各大厂面试常考题
// ============================================================
inline std::optional<std::string> getName(uintptr_t objAddr) {
  if (objAddr == 0 || g_GName == 0)
    return std::nullopt;

  /* 🛑 填空题: FName 解析逻辑
     参考: solve_speed.js:25-41

     步骤:
     1. 读取 fNameId = readU32(objAddr + UObject_NamePrivate)
     2. 计算 block = fNameId >> 16
     3. 计算 offset = fNameId & 0xFFFF
     4. fNamePool = g_GName + FNamePool_BaseOffset (0x30)
     5. chunk = readPtr(fNamePool + FNamePool_Entries_Offset + block * 8)
     6. entry = chunk + FNameEntry_Stride * offset
     7. header = readU16(entry)
     8. len = header >> FNameEntry_LenShift
     9. 如果 len > 0 && len < 100:
        返回 std::string(reinterpret_cast<char*>(entry + 2), len)

     预期输出: "FirstPersonCharacter" / "PlayerController" 等

     可用常量 (在 offsets.hpp):
     - UObject_NamePrivate = 0x18
     - FNamePool_BaseOffset = 0x30
     - FNamePool_Entries_Offset = 0x10
     - FNameEntry_Stride = 2
     - FNameEntry_LenShift = 6
  */

  return std::nullopt; // YOUR CODE HERE
}

// ============================================================
// Actor 遍历辅助
// ============================================================

struct ActorIterator {
  uintptr_t array;
  uint32_t count;
};

// 从 GWorld 获取 Actor 迭代器
inline std::optional<ActorIterator> getActorIterator(uintptr_t pGWorld) {
  if (pGWorld == 0)
    return std::nullopt;

  auto level = readPtr(pGWorld + Game::World_Level);
  if (level == 0)
    return std::nullopt;

  auto array = readPtr(level + Game::Level_ActorsArray);
  auto count = readU32(level + Game::Level_ActorsArray + 8);

  return ActorIterator{array, count};
}

// 按名称查找 Actor (单个)
inline uintptr_t findActorByName(uintptr_t pGWorld, std::string_view pattern) {
  auto iter = getActorIterator(pGWorld);
  if (!iter)
    return 0;

  for (auto actor : makeActorSpan(iter->array, iter->count)) {
    if (actor == 0)
      continue;
    auto nameOpt = getName(actor);
    if (nameOpt && nameOpt->find(pattern) != std::string::npos) {
      return actor;
    }
  }
  return 0;
}

} // namespace Game
