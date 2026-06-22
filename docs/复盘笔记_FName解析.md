# 复盘笔记：FName 解析逻辑

**日期**: 2026-01-22
**标签**: `UE4`, `FName`, `FNamePool`, `Memory Layout`, `ACE2025`
**参考**: 2025 腾讯游戏安全初赛 Writeups (NotebookLM)

---

## 0. 版本与背景

**UE4 版本**: 4.27 (ARM64)

UE4.23+ 中，`GNames` 从 `TArray<FNameEntry*>` 改为 `FNamePool` 池化分配器。解析 FName 需要理解 Block/Chunk 结构。

### 定位 GNames
在 IDA 中搜索 `"ByteProperty"` 字符串引用，指向 `FNamePool` 构造函数。

**本次比赛的 Offset**:
```
GNames Offset = 0xADF07C0  (libUE4.so 内偏移)
```

---

## 1. Analysis Path (我的思路)

### 1.1 前置知识: 什么是 FName?
- **FName** 是 UE4 的高性能字符串系统，用于存储对象名称、类名等。
- 每个 UObject 都有一个 `NamePrivate` 成员，类型是 `FName`。
- **核心思想**: 字符串只存储一次，对象仅保存 **32-bit 索引**，通过全局 `FNamePool` 解析成字符串。

### 1.2 为什么解析 FName
游戏安全开发需要：
1. 识别 Actor 类型（判断是 `PlayerController` 还是 `FirstPersonCharacter`）
2. 动态定位对象（不能硬编码所有 Actor 地址）

### 1.3 UE4 类继承结构

继承链决定偏移来源:

```
UObject                  ← Base (contains NamePrivate @ 0x18)
  └── AActor             ← +0x130 = RootComponent/Location
        └── APawn        ← Player control capabilities
              └── ACharacter     ← +0x288 = CharacterMovementComponent
                    └── FirstPersonCharacter_C  ← Blueprint 实现
```

---

## 2. Memory Layout (内存结构)

### 2.1 UObject 结构 (ARM64)

```
UObject
├── +0x00: VTablePtr         (void*)
├── +0x08: ObjectFlags       (EObjectFlags, int32)
├── +0x0C: InternalIndex     (int32)
├── +0x10: ClassPrivate      (UClass*)
├── +0x18: NamePrivate       (FName) ← 我们要读的 FNameEntryId ★
├── +0x20: OuterPrivate      (UObject*)
└── ...
```

> **Offset 0x18**: 这就是我们从 `objAddr + 0x18` 读取的原因。

### 2.2 FName / FNameEntryId 结构

FName 本质上就是一个 **32-bit 压缩索引**:

```
FNameEntryId (uint32)
├── bits 16-31: Block Index   (FNamePool 中的 chunk 索引)
└── bits  0-15: Entry Offset  (chunk 内的 entry 偏移)
```

**解码方法**:
```cpp
auto block  = fNameId >> 16;      // 高 16 位
auto offset = fNameId & 0xFFFF;   // 低 16 位
```

### 2.3 FNamePool (GNames) 结构

`GNames` 全局指针指向 `FNamePool - 0x30`（历史原因）。

```
GNames (全局变量)
    ↓ (指向 FNamePool - 0x30 的位置)
    
FNamePool (实际结构)
├── +0x00: Lock              (FRWLock, 8 bytes)
├── +0x08: CurrentBlock      (uint32)
├── +0x0C: CurrentByteCursor (uint32)
├── +0x10: Entries[8192]     (FNameEntry*[]) ← 指针数组 ★
└── ...

所以: Entries 地址 = GNames + 0x30 + 0x10 = GNames + 0x40
      或者先拿 fNamePool = GNames + 0x30，再加 0x10
```

**定位某个 Chunk**:
```cpp
auto fNamePool = g_GName + 0x30;           // FNamePool 基址
auto chunk = readPtr(fNamePool + 0x10 + block * 8);  // Entries[block]
```

### 2.4 FNameEntry 结构

每个 Entry 以 **2-byte 对齐** 存储在 Chunk 中:

```
FNameEntry
├── +0x00: Header (uint16)
│          ├── bits 0-5:  Flags (bIsWide, ProbeHashBits)
│          └── bits 6-15: Len (字符串长度, 最大 1024)
├── +0x02: Data[] (char* 或 wchar*)
└── 长度 = 2 + Len (按 2-byte 对齐)
```

**定位 Entry**:
```cpp
auto entry = chunk + 2 * offset;  // stride = 2 (FNameEntry 编码规则)
```

**解析字符串**:
```cpp
auto header = readU16(entry);
auto len = header >> 6;           // 高 10 位存储长度
auto name = std::string((char*)(entry + 2), len);
```

---

## 3. Offset Summary (偏移总表)

| 结构体 | 成员 | 偏移 | 含义 |
| :--- | :--- | :--- | :--- |
| `UObject` | `NamePrivate` | `0x18` | FName 索引 |
| `FNameEntryId` | Block | `>> 16` | Chunk 索引 |
| `FNameEntryId` | Offset | `& 0xFFFF` | Entry 偏移 |
| `GNames` → `FNamePool` | (Adjust) | `+0x30` | 历史遗留偏移 |
| `FNamePool` | `Entries[]` | `+0x10` | 指针数组 |
| `FNameEntry` | `Header` | `+0x00` | 长度+标志 (uint16) |
| `FNameEntry` | `Data[]` | `+0x02` | 实际字符串 |
| `FNameEntry` | Len | `Header >> 6` | 字符串长度 |
| `FNameEntry` | Stride | `2` | Entry 对齐单位 |

---

## 4. 常见问题

**Q1: 为什么 UE4 使用 FName 而不是 `std::string`?**
性能优化 - 相同名称只存一份，对象只存 32-bit 索引。字符串比较变成整数比较 (O(1) vs O(n))。FNamePool 有内置锁保证线程安全。

**Q2: 为什么 GNames 要加 0x30?**
UE4.23+ 从 `TArray` 改成 `FNamePool`，保留偏移兼容旧代码和工具链。

**Q3: Entry 的 stride 为什么是 2?**
FNameEntry 压缩编码。Header 2 字节，Entry 以 2-byte 对齐。

**Q4: 如何防止 getName() 崩溃?**
检查 `objAddr` 和 `g_GName` 非零，用安全读取函数 (`readU32`, `readPtr`) 不直接解引用，限制 `len < 100` 防内存越界。

**Q5: Header 的 `bIsWide` 标志位?**
`bIsWide = Header & 1`。为 1 时字符串存储为 `wchar_t` (UTF-16)，用 `readUtf16String()` 解析。用于非 ASCII 字符（日文/中文资源名）。

**Q6: 如何找到 GNames 偏移量?**
搜索 `"ByteProperty"` 字符串 XREF，引用 FNamePool 构造函数。IDA: Shift+F12 → "ByteProperty" → X → 跟踪到 FNamePool 初始化。

---

## 5. Code Reference

### 5.1 C++ 实现 (Zygisk)

**Source**: [`hacks.cpp:getName()`](file:///d:/0Document/pgm/Android/ACE2025-Prelim-Zygisk/module/src/main/cpp/hacks.cpp#L16-L98)

```cpp
std::optional<std::string> getName(uintptr_t objAddr) {
  // Step 1: 读取 FName Index (UObject + 0x18)
  auto fNameId = readU32(objAddr + kUObject_NamePrivate_Offset);
  
  // Step 2: 解码 Block 和 Offset
  auto block  = fNameId >> 16;
  auto offset = fNameId & 0xFFFF;
  
  // Step 3: 定位 FNamePool
  auto fNamePool = g_GName + 0x30;
  
  // Step 4: 读取 Chunk 并计算 Entry 地址
  auto chunk = readPtr(fNamePool + 0x10 + block * 8);
  auto entry = chunk + 2 * offset;
  
  // Step 5: 解析 Header 获取长度
  auto header = readU16(entry);
  auto len    = header >> 6;
  
  return std::string(reinterpret_cast<char*>(entry + 2), len);
}
```

### 5.2 Frida 参考实现

从比赛 Writeups 提取，用于原型验证:

```javascript
var GName_Offset = 0xADF07C0;
var GName = moduleBase.add(GName_Offset);

function getFNameFromID(fNameId) {
    try {
        // 1. 计算 Block 和 Offset
        var block = fNameId >> 16;
        var offset = fNameId & 65535;

        // 2. 定位 Chunk 指针
        var fNamePool = GName.add(0x30); 
        var blocksArray = fNamePool.add(0x10);
        var blockPtr = blocksArray.add(block * 8).readPointer();

        // 3. 定位 FNameEntry
        var fNameEntry = blockPtr.add(2 * offset);

        // 4. 解析 Header
        var header = fNameEntry.readU16();
        var len = header >> 6;
        var isWide = header & 1;

        // 5. 读取字符串
        if (len > 0 && len < 250) {
            var strAddr = fNameEntry.add(0x2);
            if (isWide) return "WideString_NotSupported";
            return strAddr.readUtf8String(len);
        }
    } catch (e) {
        return "None";
    }
    return "None";
}
```

---

## 6. UE4.23+ vs 旧版本

| 特性 | UE4.22 及以下 | UE4.23+ |
| :--- | :--- | :--- |
| **GNames 类型** | `TArray<FNameEntry*>` | `FNamePool` (池化分配器) |
| **索引结构** | 直接数组索引 | Block + Offset 二级索引 |
| **Entry 地址计算** | `GNames[index]` | `Blocks[block] + stride * offset` |
| **需要偏移调整** | 否 | 是 (`+0x30`, `+0x10`) |

用 UE4.22 方法解析 4.27 会得到错误字符串或崩溃。
