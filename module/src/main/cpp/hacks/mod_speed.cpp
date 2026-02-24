#include "../game/offsets.hpp"
#include "../utils.hpp"
#include "mod_base.hpp"
#include "registry.hpp"

namespace Hacks {

class ModSpeed : public IHackModule {
public:
  std::string_view name() const override { return "SpeedFix"; }

  void onActorFound(uintptr_t actor, std::string_view actorName) override {
    // 只处理 FirstPersonCharacter
    if (actorName.find("FirstPersonCharacter") == std::string_view::npos) {
      return;
    }

    /* 🛑 填空题: 移速修复逻辑
       参考: solve_speed.js:106-122
       参考 C++ 实现: _reference/hacks.cpp.bak (无，这是新功能)

       步骤:
       1. 读取 movementComp = readPtr(actor + Character_MovementComponent)
          - Character_MovementComponent = 0x288
       2. 检查 movementComp 是否为 0，是则 return
       3. 读取 oldSpeed = readFloat(movementComp + Movement_MaxWalkSpeed)
          - Movement_MaxWalkSpeed = 0x18c
       4. 读取 oldAccel = readFloat(movementComp + Movement_MaxAcceleration)
          - Movement_MaxAcceleration = 0x1a0
       5. 判断条件: if (oldSpeed > TARGET_SPEED + 100 || oldAccel > TARGET_SPEED
       + 100)
          - TARGET_SPEED = 600.0f
       6. 写入: writeFloat(movementComp + Movement_MaxWalkSpeed, TARGET_SPEED)
       7. 写入: writeFloat(movementComp + Movement_MaxAcceleration,
       TARGET_SPEED)
       8. LOGI("✅ Speed fixed: %.0f -> %.0f", oldSpeed, TARGET_SPEED)

       预期输出: "✅ Speed fixed: 1200 -> 600"

       可用常量 (在 game/offsets.hpp):
       - Game::Character_MovementComponent = 0x288
       - Game::Movement_MaxWalkSpeed = 0x18c
       - Game::Movement_MaxAcceleration = 0x1a0
       - Game::TARGET_SPEED = 600.0f
    */

    // YOUR CODE HERE
    auto movementComp = readPtr(actor + Game::Character_MovementComponent);
    if (movementComp == 0)
      return;

    auto oldSpeed = readFloat(movementComp + Game::Movement_MaxWalkSpeed);
    auto oldAccel = readFloat(movementComp + Game::Movement_MaxAcceleration);

    if (oldSpeed > Game::TARGET_SPEED + Game::SPEED_THRESHOLD ||
        oldAccel > Game::TARGET_SPEED + Game::SPEED_THRESHOLD) {
      writeFloat(movementComp + Game::Movement_MaxWalkSpeed,
                 Game::TARGET_SPEED);
      writeFloat(movementComp + Game::Movement_MaxAcceleration,
                 Game::TARGET_SPEED);
      LOGI("✅ Speed fixed: %.0f -> %.0f", oldSpeed, Game::TARGET_SPEED);
    }
  }
};

REGISTER_HACK(ModSpeed)

} // namespace Hacks
