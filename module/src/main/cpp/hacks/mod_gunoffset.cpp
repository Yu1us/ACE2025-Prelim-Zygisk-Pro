#include "../game/offsets.hpp"
#include "../utils.hpp"
#include "mod_base.hpp"

namespace Hacks {

class ModGunOffset : public IHackModule {
public:
  std::string_view name() const override { return "GunOffset"; }

  void onActorFound(uintptr_t actor, std::string_view actorName) override {
    if (actorName.find("FirstPersonCharacter") == std::string_view::npos) {
      return;
    }

    /* 🛑 填空题: GunOffset 修复逻辑
       参考: _reference/hacks.cpp.bak:203-208

       步骤:
       1. 写入 0.0f 到 actor + Character_GunOffset (X)
          - Character_GunOffset = 0x500
       2. 写入 0.0f 到 actor + Character_GunOffset + 4 (Y)
       3. 写入 10.0f 到 actor + Character_GunOffset + 8 (Z)
       4. LOGI("[%s] Fixed GunOffset @ %p", name().data(), (void*)actor)

       预期输出: "[GunOffset] Fixed GunOffset @ 0x7xxxxxxxxx"

       可用常量:
       - Game::Character_GunOffset = 0x500
    */

    // YOUR CODE HERE
    auto *gunOffset =
        reinterpret_cast<Game::FVector *>(actor + Game::Character_GunOffset);
    if (gunOffset) {
      *gunOffset = {0.0f, 0.0f, 10.0f};
      LOGD("[%s] Fixed GunOffset @ %p", name().data(), (void *)actor);
    }
  }
};

static ModGunOffset g_modGunOffset;
IHackModule *getModGunOffset() { return &g_modGunOffset; }

} // namespace Hacks
