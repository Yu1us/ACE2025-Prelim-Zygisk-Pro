/**
 * 子弹属性调试脚本 - 诊断 & 调参
 *
 * 功能:
 *   1. Hook SpawnProjectile，在子弹生成时 dump 关键属性
 *   2. 提供运行时修改接口: 修改 InitialSpeed / MaxSpeed / SphereRadius
 *
 * 已知偏移 (from IDA 属性注册表):
 *   Projectile Actor:
 *     +0x220  CollisionComp (USphereComponent*)
 *     +0x228  ProjectileMovement (UProjectileMovementComponent*)
 *
 *   UProjectileMovementComponent:
 *     +0xEC   InitialSpeed  (float)  正常值: 3000.0
 *     +0xF0   MaxSpeed      (float)  正常值: 3000.0
 *     +0xF4   ShouldBounce  (bitfield, u32)
 *     +0x108  ProjectileGravityScale (float)
 *     +0x110  Bounciness    (float)
 *
 *   USphereComponent (碰撞球):
 *     SphereRadius 通过虚函数 SetSphereRadius 设置
 *     内部偏移需要运行时确认 (下面有探测逻辑)
 *
 * 使用方式:
 *   frida -U -n com.xxx.game -l solve_projectile_tune.js
 *   rpc.exports 提供修改接口 (或在控制台直接调用 tune())
 */

// ==================== 常量偏移 ====================
const GWorld_Offset = 0xAFAC398;
const GName_Offset = 0xADF07C0;
const SpawnProjectile_Func_Offset = 0x8D2ED80;

const OFFSET_FNAME_ID = 0x18;
const OFFSET_LEVEL = 0x30;
const OFFSET_ACTORS = 0x98;

// Projectile Actor 成员偏移
const OFF_CollisionComp = 0x220;
const OFF_ProjMovement = 0x228;

// UProjectileMovementComponent 属性偏移
const PROJMOV_InitialSpeed = 0xEC;
const PROJMOV_MaxSpeed = 0xF0;
const PROJMOV_ShouldBounce = 0xF4;
const PROJMOV_GravityScale = 0x108;
const PROJMOV_Bounciness = 0x110;

// ==================== 调参配置 ====================
// 🛑 填空题: 根据你的观察修改这些值
// 如果不想改某个属性，设为 null
const CONFIG = {
    initialSpeed: null,    // 正常 3000.0, 如果太慢就调高
    maxSpeed: null,    // 正常 3000.0, 必须 >= initialSpeed
    gravityScale: null,    // 正常 0.0 (无重力直线飞), 数值越大弧度越大
    sphereRadius: null,    // 碰撞球半径, null = 不改
};

// ==================== 全局状态 ====================
let GName = null;
let moduleBase = null;
let spawnCount = 0;

// ==================== 工具函数 ====================

function getName(objAddr) {
    if (objAddr.isNull()) return "None";
    try {
        const fNameId = objAddr.add(OFFSET_FNAME_ID).readU32();
        const block = fNameId >> 16;
        const offset = fNameId & 65535;
        const fNamePool = GName.add(0x30);
        const chunk = fNamePool.add(0x10 + block * 8).readPointer();
        const entry = chunk.add(2 * offset);
        const header = entry.readU16();
        const len = header >> 6;
        if (len > 0 && len < 100) {
            return entry.add(2).readUtf8String(len);
        }
    } catch (e) { }
    return "None";
}

function dumpProjectileProps(actor, label) {
    try {
        const movComp = actor.add(OFF_ProjMovement).readPointer();
        if (movComp.isNull()) {
            console.log(`  [!] ${label}: ProjectileMovement == null`);
            return;
        }

        const initSpeed = movComp.add(PROJMOV_InitialSpeed).readFloat();
        const maxSpeed = movComp.add(PROJMOV_MaxSpeed).readFloat();
        const bounce = movComp.add(PROJMOV_ShouldBounce).readU32();
        const gravity = movComp.add(PROJMOV_GravityScale).readFloat();
        const bounciness = movComp.add(PROJMOV_Bounciness).readFloat();

        console.log(`  📊 ${label} 属性:`);
        console.log(`     InitialSpeed     = ${initSpeed}`);
        console.log(`     MaxSpeed         = ${maxSpeed}`);
        console.log(`     ShouldBounce     = ${bounce} (bitfield)`);
        console.log(`     GravityScale     = ${gravity}`);
        console.log(`     Bounciness       = ${bounciness}`);

        // 尝试读取碰撞球
        const collComp = actor.add(OFF_CollisionComp).readPointer();
        if (!collComp.isNull()) {
            // USphereComponent 继承自 UShapeComponent -> UPrimitiveComponent
            // SphereRadius 通常在 USphereComponent 的特有成员中
            // UE4 中 USphereComponent::SphereRadius 的偏移因版本不同
            // 我们通过在附近搜索合理的 float 值来探测
            console.log(`     CollisionComp   @ ${collComp}`);
            probeSphereRadius(collComp);
        }
    } catch (e) {
        console.log(`  [!] dump 异常: ${e}`);
    }
}

function probeSphereRadius(sphereComp) {
    // 在 USphereComponent 中搜索 SphereRadius
    // 它是一个 float，合理范围 1.0 ~ 500.0
    // 扫描偏移 0x200 ~ 0x350 附近
    const candidates = [];
    for (let off = 0x200; off < 0x360; off += 4) {
        try {
            const val = sphereComp.add(off).readFloat();
            if (val > 0.5 && val < 1000.0 && !isNaN(val)) {
                candidates.push({ offset: off, value: val });
            }
        } catch (e) { break; }
    }

    if (candidates.length > 0) {
        console.log("     [探测] 可能的 SphereRadius 候选:");
        candidates.forEach(c => {
            console.log(`       偏移 0x${c.offset.toString(16)} = ${c.value}`);
        });
    }
}

// ==================== 修改逻辑 ====================

function applyTune(actor) {
    try {
        const movComp = actor.add(OFF_ProjMovement).readPointer();
        if (movComp.isNull()) return;

        let changed = false;

        if (CONFIG.initialSpeed !== null) {
            movComp.add(PROJMOV_InitialSpeed).writeFloat(CONFIG.initialSpeed);
            changed = true;
        }
        if (CONFIG.maxSpeed !== null) {
            movComp.add(PROJMOV_MaxSpeed).writeFloat(CONFIG.maxSpeed);
            changed = true;
        }
        if (CONFIG.gravityScale !== null) {
            movComp.add(PROJMOV_GravityScale).writeFloat(CONFIG.gravityScale);
            changed = true;
        }

        if (changed) {
            console.log("  ✅ 属性已修改");
        }
    } catch (e) {
        console.log(`  [!] 修改异常: ${e}`);
    }
}

// ==================== Hook SpawnProjectile ====================

function hookSpawnProjectile() {
    const targetAddr = moduleBase.add(SpawnProjectile_Func_Offset);
    console.log(`[*] Hooking SpawnProjectile @ ${targetAddr}`);

    Interceptor.attach(targetAddr, {
        onLeave(retval) {
            // SpawnProjectile 返回值通常是新生成的 Projectile Actor
            // 但参数结构因 BP 不同而异，这里用 onEnter 的 this (args[0])
        },
        onEnter(args) {
            // args[0] 通常是 this (角色)
            // Spawn 之后子弹才存在，所以我们用定时器在下一帧抓
            spawnCount++;
            const count = spawnCount;

            setTimeout(() => {
                try {
                    const pGWorld = moduleBase.add(GWorld_Offset).readPointer();
                    if (pGWorld.isNull()) return;

                    const level = pGWorld.add(OFFSET_LEVEL).readPointer();
                    const actorsArray = level.add(OFFSET_ACTORS).readPointer();
                    const actorsCount = level.add(OFFSET_ACTORS + 8).readU32();

                    // 找最新的 Projectile
                    for (let i = actorsCount - 1; i >= Math.max(0, actorsCount - 10); i--) {
                        const actor = actorsArray.add(i * 8).readPointer();
                        if (actor.isNull()) continue;
                        const name = getName(actor);
                        if (name.indexOf("Projectile") !== -1) {
                            console.log(`\n🔫 [#${count}] 子弹生成: ${name} @ ${actor}`);
                            dumpProjectileProps(actor, "spawn-time");
                            applyTune(actor);
                            return;
                        }
                    }
                } catch (e) { }
            }, 16);  // ~1 帧延迟
        }
    });
}

// ==================== 控制台交互函数 ====================

// 在 Frida 控制台调用: tune(5000, 5000, 0.5, null)
globalThis.tune = function (initSpeed, maxSpeed, gravity, radius) {
    CONFIG.initialSpeed = initSpeed !== undefined ? initSpeed : CONFIG.initialSpeed;
    CONFIG.maxSpeed = maxSpeed !== undefined ? maxSpeed : CONFIG.maxSpeed;
    CONFIG.gravityScale = gravity !== undefined ? gravity : CONFIG.gravityScale;
    CONFIG.sphereRadius = radius !== undefined ? radius : CONFIG.sphereRadius;
    console.log("[*] 配置已更新:", JSON.stringify(CONFIG));
    console.log("[*] 下一发子弹将使用新参数");
};

// 快捷: 重置为正常值
globalThis.resetTune = function () {
    CONFIG.initialSpeed = null;
    CONFIG.maxSpeed = null;
    CONFIG.gravityScale = null;
    CONFIG.sphereRadius = null;
    console.log("[*] 已重置为观察模式 (不修改任何值)");
};

// ==================== 启动 ====================

function main() {
    console.log("===========================================");
    console.log(" 子弹属性调试 & 调参器 v1.0");
    console.log("===========================================");
    console.log("");
    console.log("使用方式:");
    console.log("  默认: 只打印子弹属性 (诊断模式)");
    console.log("  tune(initSpeed, maxSpeed, gravity, radius)");
    console.log("    例: tune(5000, 5000, 0, null)  -> 加速子弹");
    console.log("    例: tune(3000, 3000, 0, null)  -> 恢复正常");
    console.log("  resetTune() -> 停止修改");
    console.log("");

    const waitLib = setInterval(() => {
        const lib = Process.findModuleByName("libUE4.so");
        if (lib) {
            clearInterval(waitLib);
            moduleBase = lib.base;
            GName = moduleBase.add(GName_Offset);
            console.log(`[*] libUE4 基址: ${moduleBase}`);

            hookSpawnProjectile();
            console.log("[*] SpawnProjectile Hook 安装完成");
            console.log("[*] 开枪射击后将看到属性 dump");
        }
    }, 500);
}

setImmediate(main);
