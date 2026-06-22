# ACE2025-Prelim-Zygisk

Reproduction of Tencent Game Security Competition 2025 Android Preliminary Round

## Overview

This project implements a Zygisk-based module for analyzing and modifying UE4 game logic as part of the ACE2025 security competition. The competition involves identifying and fixing various game modifications in a controlled environment.

## Features

- **Modular Architecture**: Extensible module system with auto-registration
- **Modern C++20**: Type-safe memory operations with `std::optional` and `std::span`
- **Multiple Fix Modules**:
  - `mod_aim.cpp`: Aimbot patch using NOP instruction
  - `mod_speed.cpp`: Movement speed correction
  - `mod_gunoffset.cpp`: Gun offset adjustments
  - `mod_projectile.cpp`: Projectile spawn rotation correction

## Environment

- JDK 17
- NDK 26
- Gradle 8.6

## Build

**Android Studio**
Run the `packageZygisk` task directly

**Command Line**
```shell
./gradlew :module:packageZygisk
```

The artifact `HelloZygisk.zip` will be generated in the project root directory.

## Technical Highlights

**Memory Base Address**
Uses `dl_iterate_phdr` to retrieve `libUE4.so` information

**Hook Timing**
Executes during the `postAppSpecialize` phase

**Stability**
JNI pointer validation

**Architecture**
- Module registry pattern with `REGISTER_HACK` macro
- Separation of concerns: game offsets, utils, and hack modules
- ShadowHook integration for reliable inline hooking

## Documentation

The `docs/` directory contains technical write-ups covering:
- UE4 FName parsing internals
- Offset analysis methodology
- Architecture refactoring notes
- Speed/aim/projectile fix implementations

## Disclaimer

This project is for **security research and educational purposes only**. It was developed as part of the ACE2025 competition, which uses a controlled test environment separate from any production games.

## License

This project is provided as-is for educational purposes.
