# ACE2025-Prelim-Zygisk

腾讯游戏安全竞赛 2025 安卓初赛复现

## 项目简介

ACE2025 安全竞赛的 Zygisk 模块，分析和修改 UE4 游戏逻辑。比赛在测试环境中定位并修复游戏作弊功能。

## 功能模块

- `mod_aim.cpp` - 自瞄修复（NOP 指令 patch）
- `mod_speed.cpp` - 移速修正
- `mod_gunoffset.cpp` - 枪械偏移调整
- `mod_projectile.cpp` - 弹道修正

模块自动注册，C++20，`std::optional` 和 `std::span` 保证类型安全。

## 环境要求

- JDK 17
- NDK 26
- Gradle 8.6

## 编译

**Android Studio**
直接运行 `packageZygisk` 任务

**命令行**
```shell
./gradlew :module:packageZygisk
```

产物 `HelloZygisk.zip` 生成在项目根目录。

## 技术要点

**基址获取** - `dl_iterate_phdr` 读取 `libUE4.so` 信息

**Hook 时机** - `postAppSpecialize` 阶段执行

**稳定性** - JNI 指针检查

**架构设计** - `REGISTER_HACK` 宏实现模块注册，分离 game offsets、utils、hack modules，ShadowHook 做 inline hooking

## 技术文档

`docs/` - UE4 FName 解析原理、偏移量分析方法、架构重构笔记、移速/自瞄/弹道修复实现

## 声明

仅用于安全研究和教学。本项目基于 ACE2025 竞赛开发，使用测试环境，与任何生产游戏无关。

## 许可

MIT License
