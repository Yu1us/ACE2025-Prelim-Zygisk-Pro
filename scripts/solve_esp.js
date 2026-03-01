/**
 * solve_esp.js — 透视修复 Frida 脚本 v6
 *
 * 方案: LineTraceSingle 射线检测 + SetRenderInMainPass 动态开关渲染
 *       (参赛选手验证有效的"曲线救国"方案)
 *
 * 原理:
 *   每个 Tick: FirstPerson → ThirdPerson 发射射线
 *     射线无碰撞(Distance==0) → 无遮挡 → SetRenderInMainPass(1) 显示敌人
 *     射线有碰撞(Distance>0)  → 有遮挡 → SetRenderInMainPass(0) 隐藏敌人
 *
 * IDA 确认的偏移:
 *   LineTraceSingle:     0x8D1AA78
 *   SetRenderInMainPass: 0x8AB9E58 (comp+0x210 bit18)
 *   RootComponent:       Actor+0x130
 *   RelativeLocation:    RootComp+0x11C (float x,y,z)
 *   Character → Mesh:    +0x280
 */

"use strict";

const GWorld_Offset = 0xAFAC398;
const GName_Offset = 0xADF07C0;
const World_Level = 0x30;
const Level_ActorsArray = 0x98;
const UObject_Name = 0x18;
const UObject_Class = 0x10;

const Actor_RootComponent = 0x130;
const RootComp_RelLoc = 0x11C;
const Character_Mesh = 0x280;

const LineTraceSingle_Off = 0x8D1AA78;
const SetRenderInMainPass_Off = 0x8AB9E58;

const FNamePool_Base = 0x30;
const FNamePool_Entries = 0x10;
const FNameEntry_Stride = 2;
const FNameEntry_LenShift = 6;

var moduleBase = null;
var fpChar = null;   // FirstPersonCharacter
var tpChar = null;   // ThirdPersonCharacter
var tpMesh = null;   // ThirdPerson's MeshComponent

var SetRenderInMainPassNF = null;
var LineTraceSingleNF = null;

// ============================================================
// Helpers
// ============================================================
function getFName(objAddr) {
    try {
        var gNames = moduleBase.add(GName_Offset);
        var fNameId = objAddr.add(UObject_Name).readU32();
        var block = fNameId >>> 16;
        var offset = fNameId & 0xFFFF;
        var chunk = gNames.add(FNamePool_Base).add(FNamePool_Entries + block * 8).readPointer();
        if (chunk.isNull()) return null;
        var entry = chunk.add(offset * FNameEntry_Stride);
        var header = entry.readU16();
        var len = header >>> FNameEntry_LenShift;
        if (len > 0 && len < 100) return entry.add(2).readUtf8String(len);
    } catch (e) { }
    return null;
}

function forEachActor(callback) {
    try {
        var pGWorld = moduleBase.add(GWorld_Offset).readPointer();
        if (pGWorld.isNull()) return;
        var level = pGWorld.add(World_Level).readPointer();
        if (level.isNull()) return;
        var arr = level.add(Level_ActorsArray).readPointer();
        var cnt = level.add(Level_ActorsArray + 0x8).readU32();
        for (var i = 0; i < cnt; i++) {
            var actor = arr.add(i * Process.pointerSize).readPointer();
            if (!actor.isNull()) callback(actor);
        }
    } catch (e) { }
}

function getActorLocation(actor) {
    try {
        var rootComp = actor.add(Actor_RootComponent).readPointer();
        if (rootComp.isNull()) return null;
        var loc = rootComp.add(RootComp_RelLoc);
        return {
            x: loc.readFloat(),
            y: loc.add(4).readFloat(),
            z: loc.add(8).readFloat()
        };
    } catch (e) { return null; }
}

// ============================================================
// Actor 查找
// ============================================================
function findCharacters() {
    fpChar = null;
    tpChar = null;
    tpMesh = null;

    forEachActor(function (actor) {
        var name = getFName(actor);
        if (!name) return;
        if (name.indexOf("FirstPerson") !== -1 && name.indexOf("Character") !== -1) {
            fpChar = actor;
            console.log("[*] FirstPerson @ " + actor);
        }
        if (name.indexOf("ThirdPerson") !== -1) {
            tpChar = actor;
            try {
                tpMesh = actor.add(Character_Mesh).readPointer();
            } catch (e) { }
            console.log("[*] ThirdPerson @ " + actor + " mesh=" + tpMesh);
        }
    });

    if (fpChar && tpChar) {
        var fpLoc = getActorLocation(fpChar);
        var tpLoc = getActorLocation(tpChar);
        console.log("[*] FP位置: " + JSON.stringify(fpLoc));
        console.log("[*] TP位置: " + JSON.stringify(tpLoc));
        return true;
    }
    console.log("[-] 未找到角色");
    return false;
}

// ============================================================
// 核心: 射线检测判断遮挡
// ============================================================
function checkOcclusion() {
    if (!fpChar || !tpChar) return false;

    var fpLoc = getActorLocation(fpChar);
    var tpLoc = getActorLocation(tpChar);
    if (!fpLoc || !tpLoc) return false;

    // 分配 HitResult (足够大的空间)
    var hitResult = Memory.alloc(0x200);
    Memory.patchCode(hitResult, 0x200, function (code) {
        // 清零
    });
    hitResult.writeByteArray(new Array(0x200).fill(0));

    // 调用 LineTraceSingle
    // IDA 签名: sub_8D1AA78(
    //   __int64 a1,         // WorldContextObject (Actor)
    //   unsigned int a2,    // TraceChannel
    //   char a3,            // bTraceComplex
    //   __int64 a4,         // FHitResult* (will be constructed internally? need to check)
    //   float a5 (s0),      // Start.X
    //   float a6 (s1),      // Start.Y  
    //   float a7 (s2),      // Start.Z
    //   float a8 (s3),      // End.X
    //   float a9 (s4),      // End.Y
    //   float a10 (s5),     // End.Z
    //   __int64 a11,        // ActorsToIgnore array (ptr)
    //   __int64 a12,        // HitResult out (ptr)
    //   char a13            // bIgnoreSelf
    // )

    try {
        var result = LineTraceSingleNF(
            fpChar,                // WorldContextObject
            1,                      // TraceChannel = Visibility
            0,                      // bTraceComplex = false
            ptr(0),                 // Ignored param
            fpLoc.x, fpLoc.y, fpLoc.z,   // Start
            tpLoc.x, tpLoc.y, tpLoc.z,   // End
            ptr(0),                 // ActorsToIgnore
            hitResult,              // HitResult
            1                       // bIgnoreSelf
        );

        // HitResult+0x8 = Distance
        var distance = hitResult.add(0x8).readFloat();
        return { hit: result, distance: distance };
    } catch (e) {
        console.log("[-] LineTrace error: " + e);
        return null;
    }
}

// ============================================================
// ESP 修复 tick 函数
// ============================================================
var lastState = -1;  // -1=unknown, 0=hidden, 1=visible

function espTickFix() {
    if (!tpMesh || tpMesh.isNull()) return;

    var result = checkOcclusion();
    if (!result) return;

    if (result.distance === 0 || !result.hit) {
        // 无遮挡 → 应该能正常看到 → 显示
        if (lastState !== 1) {
            SetRenderInMainPassNF(tpMesh, 1);
            lastState = 1;
        }
    } else {
        // 有遮挡 → 不应该看到 → 隐藏
        if (lastState !== 0) {
            SetRenderInMainPassNF(tpMesh, 0);
            lastState = 0;
        }
    }
}

// ============================================================
// Main
// ============================================================
function main() {
    console.log("============================================");
    console.log("[*] solve_esp.js v6 — 射线检测修复透视");
    console.log("[*] LineTrace + SetRenderInMainPass");
    console.log("============================================");

    var mod = Process.findModuleByName("libUE4.so");
    if (!mod) {
        var t = setInterval(function () {
            mod = Process.findModuleByName("libUE4.so");
            if (mod) { clearInterval(t); moduleBase = mod.base; onReady(); }
        }, 500);
    } else {
        moduleBase = mod.base;
        onReady();
    }
}

function onReady() {
    console.log("[*] base = " + moduleBase);

    // 初始化 NativeFunction
    // LineTraceSingle: bool(ptr, uint, char, ptr, float*6, ptr, ptr, char)
    LineTraceSingleNF = new NativeFunction(
        moduleBase.add(LineTraceSingle_Off),
        'bool',
        ['pointer', 'uint32', 'uint8', 'pointer',
            'float', 'float', 'float',
            'float', 'float', 'float',
            'pointer', 'pointer', 'uint8']
    );

    SetRenderInMainPassNF = new NativeFunction(
        moduleBase.add(SetRenderInMainPass_Off),
        'void', ['pointer', 'int']
    );

    console.log("[*] NativeFunction 初始化完成");

    // 等 GWorld
    var gw = setInterval(function () {
        try {
            var p = moduleBase.add(GWorld_Offset).readPointer();
            if (!p.isNull()) {
                clearInterval(gw);
                console.log("[*] GWorld = " + p);

                setTimeout(function () {
                    if (!findCharacters()) {
                        console.log("[-] 未找到角色，5秒后重试...");
                        setTimeout(function () { findCharacters(); startTick(); }, 5000);
                    } else {
                        startTick();
                    }
                }, 5000);
            }
        } catch (e) { }
    }, 1000);
}

function startTick() {
    if (!fpChar || !tpChar || !tpMesh) {
        console.log("[-] 无法启动修复: 角色未找到");
        return;
    }

    console.log("[*] 启动 ESP 修复 tick (100ms)...");
    console.log("[*] 如射线检测崩溃，改用 setInterval + SetRenderInMainPass(0)");

    // 先直接测试一次射线
    var testResult = checkOcclusion();
    if (testResult) {
        console.log("[*] 射线测试: hit=" + testResult.hit + " distance=" + testResult.distance);
    } else {
        console.log("[!] 射线检测失败，回退到简单方案: 直接 SetRenderInMainPass(0)");
        SetRenderInMainPassNF(tpMesh, 0);
        console.log("[✅] 直接隐藏了 ThirdPerson (无射线检测)");
        console.log("[*] 手动调用 rpc.exports.show() 可恢复");
        return;
    }

    // 启动定时修复
    setInterval(espTickFix, 100);
    console.log("[✅] ESP 修复已激活!");
}

rpc.exports = {
    find: function () { findCharacters(); },
    check: function () {
        var r = checkOcclusion();
        console.log(JSON.stringify(r));
        return r;
    },
    hide: function () {
        if (tpMesh) {
            SetRenderInMainPassNF(tpMesh, 0);
            lastState = 0;
            console.log("Hidden");
        }
    },
    show: function () {
        if (tpMesh) {
            SetRenderInMainPassNF(tpMesh, 1);
            lastState = 1;
            console.log("Shown");
        }
    }
};

main();
