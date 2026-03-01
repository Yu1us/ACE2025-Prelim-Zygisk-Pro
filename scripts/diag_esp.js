/**
 * diag_esp.js — ESP 透视诊断脚本 (深度运行时分析)
 *
 * 目标: 找到红色穿墙效果的实际实现机制
 * 思路:
 *   1. Dump ThirdPersonCharacter 所有 Component 的 bRenderCustomDepth
 *   2. 检查材质的 bDisableDepthTest
 *   3. Hook SetRenderCustomDepth 看是否有动态调用
 *   4. Hook SetMaterial 看是否有材质替换
 *   5. 扫描所有 Actor 的 OwnedComponents 列表
 */

"use strict";

const GWorld_Offset = 0xAFAC398;
const GName_Offset = 0xADF07C0;
const World_Level = 0x30;
const Level_Actors = 0x98;
const UObject_Name = 0x18;
const UObject_Class = 0x10;

const Comp_QWORD210 = 0x210;  // QWORD 包含多个 bitfield
const Comp_Byte216 = 0x216;  // bRenderCustomDepth: bit6 (mask 0x40)

// UE4 Actor -> OwnedComponents (TSet<UActorComponent*>)
// 这个偏移需要运行时确认，但通常在 AActor 的一个固定偏移
// 从 IDA 看 AActor 的结构

const SetRenderCustomDepth_Offset = 0x8AB9DE8;
const SetCustomDepthStencilValue_Offset = 0x8AB9E0C;
// SetMaterial exec 函数附近的地址 (UPrimitiveComponent::SetMaterial)
// 需要从 IDA 确认

const FNamePool_Base = 0x30;
const FNamePool_Entries = 0x10;
const FNameEntry_Stride = 2;
const FNameEntry_LenShift = 6;

var moduleBase = null;
var hookLog = [];

function getFName(objAddr) {
    try {
        var gNames = moduleBase.add(GName_Offset);
        var fNameId = objAddr.add(UObject_Name).readU32();
        var block = fNameId >>> 16;
        var offset = fNameId & 0xFFFF;
        var fNamePool = gNames.add(FNamePool_Base);
        var chunk = fNamePool.add(FNamePool_Entries + block * 8).readPointer();
        if (chunk.isNull()) return null;
        var entry = chunk.add(offset * FNameEntry_Stride);
        var header = entry.readU16();
        var len = header >>> FNameEntry_LenShift;
        if (len > 0 && len < 100) return entry.add(2).readUtf8String(len);
    } catch (e) { }
    return null;
}

function getClassName(objAddr) {
    try {
        var classPtr = objAddr.add(UObject_Class).readPointer();
        if (classPtr.isNull()) return null;
        return getFName(classPtr);
    } catch (e) { }
    return null;
}

function forEachActor(callback) {
    try {
        var pGWorld = moduleBase.add(GWorld_Offset).readPointer();
        if (pGWorld.isNull()) return;
        var level = pGWorld.add(World_Level).readPointer();
        if (level.isNull()) return;
        var actorArray = level.add(Level_Actors).readPointer();
        var actorCount = level.add(Level_Actors + 0x8).readU32();
        for (var i = 0; i < actorCount; i++) {
            var actor = actorArray.add(i * Process.pointerSize).readPointer();
            if (actor.isNull()) continue;
            callback(actor);
        }
    } catch (e) {
        console.log("[-] forEachActor error: " + e);
    }
}

// === 方案 1: Hook SetRenderCustomDepth 看谁在调用 ===
function hookSetRenderCustomDepth() {
    var funcAddr = moduleBase.add(SetRenderCustomDepth_Offset);
    Interceptor.attach(funcAddr, {
        onEnter: function (args) {
            var bNewValue = args[1].toInt32();
            var comp = args[0];
            var className = getClassName(comp);
            var msg = "[Hook SetRenderCustomDepth] comp=" + comp +
                " class=" + className +
                " bNew=" + bNewValue;
            console.log(msg);
            hookLog.push(msg);

            // 打印调用栈
            console.log(Thread.backtrace(this.context, Backtracer.ACCURATE)
                .map(DebugSymbol.fromAddress).join('\n'));
        }
    });
    console.log("[*] Hooked SetRenderCustomDepth at " + funcAddr);
}

// === 方案 2: Hook SetCustomDepthStencilValue ===
function hookSetCustomDepthStencilValue() {
    var funcAddr = moduleBase.add(SetCustomDepthStencilValue_Offset);
    Interceptor.attach(funcAddr, {
        onEnter: function (args) {
            var value = args[1].toInt32();
            var comp = args[0];
            var className = getClassName(comp);
            console.log("[Hook SetCustomDepthStencilValue] comp=" + comp +
                " class=" + className +
                " value=" + value);
        }
    });
    console.log("[*] Hooked SetCustomDepthStencilValue at " + funcAddr);
}

// === 方案 3: 扫描所有 Actor 的 +0x210 QWORD ===
// 查看 bRenderCustomDepth (bit54) 和其他渲染属性
function deepScanActors() {
    console.log("\n======== 深度 Actor/Component 扫描 ========");
    var results = [];

    forEachActor(function (actor) {
        var name = getFName(actor);
        var className = getClassName(actor);

        if (!name) return;

        // 只关注角色类的 Actor
        var isInteresting = (
            name.indexOf("ThirdPerson") !== -1 ||
            name.indexOf("FirstPerson") !== -1 ||
            name.indexOf("Character") !== -1 ||
            name.indexOf("Pawn") !== -1 ||
            (className && className.indexOf("Character") !== -1)
        );

        if (!isInteresting) return;

        console.log("\n[Actor] " + name + " (" + className + ") @ " + actor);

        // 尝试 dump Actor 的各种 Component 偏移
        // UE4 AActor 常见 Component 偏移:
        //   RootComponent:    通常在 0x130-0x138
        //   Mesh (Character): 通常在 0x280  
        //   CapsuleComponent: 在 Character 类中

        var componentOffsets = [
            { name: "RootComponent", off: 0x130 },
            { name: "Mesh(Character)", off: 0x280 },
            { name: "CapsuleComp", off: 0x288 },
            { name: "CharacterMovement", off: 0x290 },
            // FirstPersonCharacter 特有
            { name: "FP_Camera(a1+0x4E0)", off: 0x4E0 },
            { name: "FP_Mesh1P(a1+0x4B8)", off: 0x4B8 },
            { name: "FP_Gun(a1+0x4C0)", off: 0x4C0 },
        ];

        for (var ci = 0; ci < componentOffsets.length; ci++) {
            var co = componentOffsets[ci];
            try {
                var compPtr = actor.add(co.off).readPointer();
                if (compPtr.isNull()) continue;

                var compName = getFName(compPtr);
                var compClass = getClassName(compPtr);

                // 读取 +0x210 QWORD 检查 bitfields
                try {
                    var qword210 = compPtr.add(0x210).readU64();
                    var bit54 = qword210.shr(54).and(1).toNumber();   // bRenderCustomDepth
                    var bit31 = qword210.shr(31).and(1).toNumber();   // bOwnerNoSee
                    var bit28 = qword210.shr(28).and(1).toNumber();   // bOnlyOwnerSee
                    var bit20 = qword210.shr(20).and(1).toNumber();   // 另一个 RenderCustomDepth?

                    // 读 +0x1F8 检查材质相关的 bDisableDepthTest
                    var byte1F8 = compPtr.add(0x1F8).readU8();

                    console.log("  [" + co.name + "] @ " + compPtr +
                        " (" + (compClass || "?") + ")");
                    console.log("    +0x210 QWORD = 0x" + qword210.toString(16));
                    console.log("    bit54(CustomDepth)=" + bit54 +
                        " bit31(OwnerNoSee)=" + bit31 +
                        " bit28(OnlyOwnerSee)=" + bit28 +
                        " bit20(?)=" + bit20);
                    console.log("    +0x1F8 byte = 0x" + byte1F8.toString(16));

                    if (bit54) {
                        console.log("    ⚠️ bRenderCustomDepth IS ON!");
                    }
                } catch (e2) {
                    console.log("  [" + co.name + "] @ " + compPtr +
                        " - 无法读取 +0x210");
                }
            } catch (e) { }
        }

        // 尝试扫描 Actor 的 OwnedComponents (TSet)
        // OwnedComponents 通常在 AActor 中位于某个固定偏移
        // UE4.27 中通常在 0xF0 左右
        // 让我暴力扫描 actor 内部所有看起来像指针的地方
        console.log("  --- 暴力扫描 Actor 指针域 ---");
        try {
            for (var off = 0x100; off < 0x300; off += 8) {
                var val = actor.add(off).readPointer();
                if (val.isNull()) continue;

                // 检查这个值是否看起来像 UObject (有 VTable 和 Name)
                try {
                    var possibleVTable = val.readPointer();
                    if (possibleVTable.isNull()) continue;

                    var possibleName = getFName(val);
                    if (!possibleName) continue;

                    var possibleClass = getClassName(val);

                    // 它是一个 UObject! 检查是 Component 吗
                    if (possibleClass && (
                        possibleClass.indexOf("Component") !== -1 ||
                        possibleClass.indexOf("Mesh") !== -1)) {

                        // 检查 bRenderCustomDepth
                        try {
                            var q = val.add(0x210).readU64();
                            var rcd = q.shr(54).and(1).toNumber();
                            var flag = rcd ? "⚠️ ON" : "off";
                            console.log("  +0x" + off.toString(16) + ": " +
                                possibleName + " (" + possibleClass + ")" +
                                " bRenderCustomDepth=" + flag);
                        } catch (e3) {
                            console.log("  +0x" + off.toString(16) + ": " +
                                possibleName + " (" + possibleClass + ")" +
                                " [无法读 +0x210]");
                        }
                    }
                } catch (e4) { }
            }
        } catch (e5) { }
    });

    console.log("\n============================================\n");
}

// === 方案 4: dump bDisableDepthTest 偏移 ===
// bDisableDepthTest 在 UMaterialInterface 上
// 从 IDA 反射表 xref 0xaa369c0 处的 bDisableDepthTest property
// 让我解析它的偏移
function checkMaterialDepthTest() {
    console.log("\n======== 材质 bDisableDepthTest 检查 ========");
    // TODO: 需要从 Component 获取 MaterialInterface 列表
    // UMeshComponent 的 Materials 数组通常在某个偏移

    forEachActor(function (actor) {
        var name = getFName(actor);
        if (!name || name.indexOf("ThirdPerson") === -1) return;

        console.log("[*] Checking materials for: " + name);

        // 尝试从 Character 的 Mesh component (0x280) 拿材质
        try {
            var meshComp = actor.add(0x280).readPointer();
            if (meshComp.isNull()) return;

            console.log("  MeshComp @ " + meshComp);

            // UMeshComponent -> OverrideMaterials (TArray<UMaterialInterface*>)
            // 这个偏移在 UE4 中通常在 0x588 左右 (不同版本变化大)
            // 先 dump 一定范围看看
            console.log("  Hexdump MeshComp+0x570 to +0x5c0:");
            console.log(hexdump(meshComp.add(0x570), { length: 80, ansi: false }));

            // 也看看更底层的: 检查 component 是否有被标记为 "visible through walls"
            // bDepthTest 等渲染属性通常在 SceneProxy 上而非 Component 直接

        } catch (e) {
            console.log("  Error: " + e);
        }
    });

    console.log("==============================================\n");
}

// 主入口
function main() {
    console.log("===========================================");
    console.log("[*] diag_esp.js — ESP 深度诊断 v1");
    console.log("===========================================");

    var mod = Process.findModuleByName("libUE4.so");
    if (!mod) {
        console.log("[*] 等待 libUE4.so ...");
        var timer = setInterval(function () {
            mod = Process.findModuleByName("libUE4.so");
            if (mod) {
                clearInterval(timer);
                moduleBase = mod.base;
                onReady();
            }
        }, 500);
    } else {
        moduleBase = mod.base;
        onReady();
    }
}

function onReady() {
    console.log("[*] libUE4.so base = " + moduleBase);

    // Hook 引擎函数 (在 GWorld 之前就设置)
    hookSetRenderCustomDepth();
    hookSetCustomDepthStencilValue();

    // 等 GWorld
    console.log("[*] 等待 GWorld ...");
    var gw = setInterval(function () {
        try {
            var p = moduleBase.add(GWorld_Offset).readPointer();
            if (!p.isNull()) {
                clearInterval(gw);
                console.log("[*] GWorld = " + p);

                // 延迟扫描
                setTimeout(function () {
                    deepScanActors();
                    checkMaterialDepthTest();
                }, 5000);
            }
        } catch (e) { }
    }, 1000);
}

rpc.exports = {
    scan: function () { deepScanActors(); },
    mat: function () { checkMaterialDepthTest(); },
    log: function () { return hookLog; }
};

main();
