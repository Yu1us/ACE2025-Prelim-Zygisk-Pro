#pragma once
#include <cstdint>

namespace Game {

// ========== 全局符号 ==========
// [Source: NotebookLM WriteUp]
constexpr uintptr_t GWorld_Offset = 0xAFAC398;
constexpr uintptr_t GName_Offset = 0xADF07C0;

// ========== 函数偏移 ==========
constexpr uintptr_t SpawnProjectile_Func_Offset = 0x8D2ED80;

// ========== UObject 结构 ==========
// UObject 结构:
//   +0x00: VTablePtr
//   +0x08: ObjectFlags (EObjectFlags)
//   +0x0C: InternalIndex (int32)
//   +0x10: ClassPrivate (UClass*)
//   +0x18: NamePrivate (FName)  <-- FNameEntryId
constexpr uintptr_t UObject_NamePrivate = 0x18;

// ========== FNamePool 结构 ==========
// GNames 指向 FNamePool 前 0x30 的位置
// 真正的 FNamePool = GNames + 0x30
// Entries 数组 = FNamePool + 0x10
constexpr uintptr_t FNamePool_BaseOffset = 0x30;
constexpr uintptr_t FNamePool_Entries_Offset = 0x10;
constexpr uintptr_t FNameEntry_Stride = 2;  // 2-byte 对齐
constexpr uint16_t FNameEntry_LenShift = 6; // 长度在 header >> 6

// ========== Actor 遍历 ==========
constexpr uintptr_t World_Level = 0x30;
constexpr uintptr_t Level_ActorsArray = 0x98;

// ========== FirstPersonCharacter ==========
constexpr uintptr_t Character_GunOffset = 0x500;
constexpr uintptr_t Character_MovementComponent =
    0x288; // from solve_speed.js:110

// ========== CharacterMovementComponent ==========
constexpr uintptr_t Movement_MaxWalkSpeed = 0x18c;    // from solve_speed.js:113
constexpr uintptr_t Movement_MaxAcceleration = 0x1a0; // from solve_speed.js:114

// ========== PlayerController ==========
constexpr uintptr_t Controller_ControlRotation = 0x288;

// ========== 游戏常量 ==========
constexpr float TARGET_SPEED = 600.0f; // from solve_speed.js:17
constexpr float SPEED_THRESHOLD = 100.0f;

// ========== 简单结构 ==========
struct Vector3 {
  float x, y, z;
};
struct Rotator {
  float Pitch, Yaw, Roll;
};

} // namespace Game
