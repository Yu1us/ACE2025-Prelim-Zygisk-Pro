/**
 * solve_esp.js — 透视修复 Frida 原型脚本
 * 
 * 作弊原理: 通过开启 Actor 的 bRenderCustomDepth + 后处理材质实现红色描边穿墙
 * 修复策略: 
 *   方案 A — Hook SetRenderCustomDepth，拦截 API 层调用，强制 bEnabled=false
 *   方案 B — 遍历所有 Actor，直写 bRenderCustomDepth=0 (兜底)
 * 
 * [Source: NotebookLM Writeup 交叉验证]
 */

"use strict";

// ============================================================
// 偏移量 (与 offsets.hpp 保持同步)
// ============================================================
const GWorld_Offset = 0xAFAC398;
const GName_Offset = 0xADF07C0;
const World_Level = 0x30;
const Level_ActorsArray = 0x98;
const UObject_NamePrivate = 0x18;

// ESP 专用
const Actor_RenderCustomDepth_Byte = 0x212;   // packed bitfield byte
const RenderCustomDepth_BitIndex = 3;       // bit3
const Character_SkeletalMeshComp = 0x280;   // Character -> SkeletalMeshComponent

// 引擎函数
const SetRenderCustomDepth_Offset = 0x8AB9DE8;
const SetCustomDepthStencilValue_Offset = 0x8AB9E0C;

// FName 解析常量
const FNamePool_BaseOffset = 0x30;
const FNamePool_Entries_Offset = 0x10;
const FNameEntry_Stride = 2;
const FNameEntry_LenShift = 6;

var moduleBase = null;

// ============================================================
// FName 解析 (复用 solve_speed.js 的逻辑)
// ============================================================
function getFName(objAddr) {
    try {
        var gNames = moduleBase.add(GName_Offset);
        var fNameId = objAddr.add(UObject_NamePrivate).readU32();

        var block = fNameId >>> 16;
        var offset = fNameId & 0xFFFF;

        var fNamePool = gNames.add(FNamePool_BaseOffset);
        var chunk = fNamePool.add(FNamePool_Entries_Offset + block * 8).readPointer();
        if (chunk.isNull()) return null;

        var entry = chunk.add(offset * FNameEntry_Stride);
        var header = entry.readU16();
        var len = header >>> FNameEntry_LenShift;

        if (len > 0 && len < 100) {
            return entry.add(2).readUtf8String(len);
        }
    } catch (e) { }
    return null;
}

// ============================================================
// Actor 遍历器
// ============================================================
function forEachActor(callback) {
    try {
        var pGWorld = moduleBase.add(GWorld_Offset).readPointer();
        if (pGWorld.isNull()) return;

        var level = pGWorld.add(World_Level).readPointer();
        if (level.isNull()) return;

        var actorArray = level.add(Level_ActorsArray).readPointer();
        var actorCount = level.add(Level_ActorsArray + 0x8).readU32();

        for (var i = 0; i < actorCount; i++) {
            var actor = actorArray.add(i * Process.pointerSize).readPointer();
            if (actor.isNull()) continue;

            var name = getFName(actor);
            callback(actor, name);
        }
    } catch (e) {
        console.log("[-] forEachActor error: " + e);
    }
}

// ============================================================
// 方案 A  —  Hook SetRenderCustomDepth
// 拦截引擎 API，强制 bEnabled = false
// ============================================================
function hookSetRenderCustomDepth() {
    var funcAddr = moduleBase.add(SetRenderCustomDepth_Offset);
    console.log("[*] Hooking SetRenderCustomDepth at " + funcAddr);

    // void SetRenderCustomDepth(UPrimitiveComponent* this, bool bNewValue)
    Interceptor.attach(funcAddr, {
        onEnter: function (args) {
            var bNewValue = args[1].toInt32();
            if (bNewValue !== 0) {
                // 强制关闭 CustomDepth
                args[1] = ptr(0);
                console.log("[✅ Hook] SetRenderCustomDepth intercepted, forced false");
            }
        }
    });
}

// ============================================================
// 方案 B  —  遍历所有 Actor，直写 bRenderCustomDepth = 0
// 用作兜底，对抗直接内存修改
// ============================================================
function clearCustomDepthAllActors() {
    var fixedCount = 0;

    forEachActor(function (actor, name) {
        try {
            var byteAddr = actor.add(Actor_RenderCustomDepth_Byte);
            var byteVal = byteAddr.readU8();
            var bitSet = (byteVal >>> RenderCustomDepth_BitIndex) & 1;

            if (bitSet === 1) {
                // 清除 bit3
                var newVal = byteVal & ~(1 << RenderCustomDepth_BitIndex);
                byteAddr.writeU8(newVal);
                fixedCount++;

                if (name) {
                    console.log("[✅ Clean] " + name + " bRenderCustomDepth cleared");
                }
            }
        } catch (e) { }
    });

    return fixedCount;
}

// ============================================================
// 诊断: 扫描哪些 Actor 被开启了 CustomDepth
// ============================================================
function scanCustomDepthActors() {
    console.log("\n========== CustomDepth 扫描 ==========");
    var found = 0;

    forEachActor(function (actor, name) {
        try {
            var byteVal = actor.add(Actor_RenderCustomDepth_Byte).readU8();
            var bitSet = (byteVal >>> RenderCustomDepth_BitIndex) & 1;

            if (bitSet === 1) {
                found++;
                console.log("[!] " + (name || "Unknown") + " @ " + actor +
                    "  byte=0x" + byteVal.toString(16) +
                    "  bRenderCustomDepth=ON");
            }
        } catch (e) { }
    });

    console.log("[*] 扫描完成，发现 " + found + " 个 Actor 开启了 CustomDepth");
    console.log("=====================================\n");
}

// ============================================================
// 主入口
// ============================================================
function main() {
    console.log("============================================");
    console.log("[*] solve_esp.js — ESP 透视修复脚本");
    console.log("============================================");

    // 等待 libUE4.so
    var mod = Process.findModuleByName("libUE4.so");
    if (!mod) {
        console.log("[*] 等待 libUE4.so 加载...");
        var timer = setInterval(function () {
            mod = Process.findModuleByName("libUE4.so");
            if (mod) {
                clearInterval(timer);
                moduleBase = mod.base;
                console.log("[*] libUE4.so base = " + moduleBase);
                onModuleReady();
            }
        }, 500);
    } else {
        moduleBase = mod.base;
        console.log("[*] libUE4.so base = " + moduleBase);
        onModuleReady();
    }
}

function onModuleReady() {
    // 方案 A: 安装 Hook (一次性)
    hookSetRenderCustomDepth();

    // 等 GWorld 就绪后启动方案 B 循环
    console.log("[*] 等待 GWorld...");
    var gwTimer = setInterval(function () {
        try {
            var pGWorld = moduleBase.add(GWorld_Offset).readPointer();
            if (!pGWorld.isNull()) {
                clearInterval(gwTimer);
                console.log("[*] GWorld ready: " + pGWorld);

                // 先做一次诊断扫描
                scanCustomDepthActors();

                // 方案 B: 定时遍历清零 (每 2 秒)
                console.log("[*] 启动方案 B 定时清理 (2s interval)...");
                setInterval(function () {
                    var n = clearCustomDepthAllActors();
                    if (n > 0) {
                        console.log("[*] 本轮修复了 " + n + " 个 Actor");
                    }
                }, 2000);
            }
        } catch (e) { }
    }, 1000);
}

// RPC 导出，方便手动触发
rpc.exports = {
    scan: function () { scanCustomDepthActors(); },
    fix: function () { return clearCustomDepthAllActors(); }
};

main();
