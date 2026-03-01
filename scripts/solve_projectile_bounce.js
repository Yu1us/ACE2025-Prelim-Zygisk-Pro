/**
 * 子弹反弹抑制 v3 - 纯 OnHit Hook
 *
 * 策略: 只 hook OnHit，碰撞瞬间拦截
 *   - onEnter: 置零 bShouldBounce 阻止弹跳
 *   - setTimeout: 延迟 1 帧调用 K2_DestroyActor 销毁弹体
 *     (避免在碰撞回调内部直接销毁导致 re-entrancy crash)
 *
 * v2 教训: spawn-time patch 会导致子弹卡在枪口
 *   因为 writeU32(0) 可能清零了 bitfield 中的其他运动标志
 */

// ==================== 常量偏移 ====================
const GWorld_Offset = 0xAFAC398;
const GName_Offset = 0xADF07C0;
const OnHit_Offset = 0x6711D34;

const OFFSET_FNAME_ID = 0x18;

// Projectile Anti-Bounce
const Projectile_MovementComponent = 0x228;
const ProjMovement_ShouldBounce = 0xF4;
const VTable_K2_DestroyActor = 0x318;

// ==================== 全局状态 ====================
let GName = null;
let moduleBase = null;
let destroyCount = 0;

// ==================== 工具函数 ====================

// ==================== UE4 FName 内存布局常量 (4.23+ FNamePool) ====================
// FNameId (32-bit): 高 16 位为 Block Index, 低 16 位为 Offset
const FNAME_BLOCK_SHIFT = 16;
const FNAME_OFFSET_MASK = 0xFFFF; // 65535

// FNamePool 结构:
// struct FNamePool { FNameEntryAllocator Allocator; ... }
// 经逆向分析该游戏版本 GName 向下偏移 0x40 处为 Blocks 指针数组
// (即 Allocator 偏移 0x30，其内部 Blocks 偏移 0x10)
const FNAMEPOOL_BLOCKS_OFFSET = 0x40;
const POINTER_SIZE = 8; // ARM64

// 内存块对齐步长 (Stride)
const FNAME_ENTRY_STRIDE = 2; // 块内偏移量需要乘 2 才能得到字节偏移

// FNameEntry 头部: 16位 (2字节)
// bit [6:15]: 字符串长度 (Length)
// bit [0:5]:  标志位 (bIsWide 等)
const FNAME_HEADER_SHIFT = 6;
const FNAME_HEADER_SIZE = 2;

function getName(objAddr) {
    if (objAddr.isNull()) return "None";
    try {
        const fNameId = objAddr.add(OFFSET_FNAME_ID).readU32();

        // 1. 解析 FNameEntryHandle (Block 和 Offset)
        const block = fNameId >> FNAME_BLOCK_SHIFT;
        const offset = fNameId & FNAME_OFFSET_MASK;

        // 2. 定位对应的块 (Chunk/Block) 内存地址
        /* 🛑 填空题 1: 根据 GName、FNAMEPOOL_BLOCKS_OFFSET 和块索引，计算当前 block 的地址 */
        // const chunkPtr = ???.add(??? + block * POINTER_SIZE);
        const chunk = GName.add(FNAMEPOOL_BLOCKS_OFFSET + block * POINTER_SIZE).readPointer();

        // 3. 定位具体的 FNameEntry
        /* 🛑 填空题 2: 使用 chunk 起始地址、offset 以及 FNAME_ENTRY_STRIDE 计算 entry 物理地址 */
        // const entry = ???;
        const entry = chunk.add(offset * FNAME_ENTRY_STRIDE);

        // 4. 解析 FNameEntry Header
        const header = entry.readU16();
        const len = header >> FNAME_HEADER_SHIFT; // 剔除标志位获取真实长度

        if (len > 0 && len < 100) {
            // 跳过 Header 的 2 字节读取实际字符串内容
            return entry.add(FNAME_HEADER_SIZE).readUtf8String(len);
        }
    } catch (e) { }
    return "None";
}

// ==================== OnHit Hook ====================

function hookOnHit() {
    const targetAddr = moduleBase.add(OnHit_Offset);
    console.log(`[*] Hooking OnHit @ ${targetAddr}`);

    Interceptor.attach(targetAddr, {
        onEnter(args) {
            // args[0] = this (Projectile Actor)
            const actor = args[0];
            if (actor.isNull()) return;

            try {
                const name = getName(actor);
                if (name.indexOf("FirstPersonProjectile_C") === -1) return;

                // 1. 置零 bShouldBounce 阻止引擎执行弹跳
                const movComp = actor.add(Projectile_MovementComponent).readPointer();
                if (!movComp.isNull()) {
                    const bounceAddr = movComp.add(ProjMovement_ShouldBounce);
                    const cur = bounceAddr.readU32();
                    if (cur !== 0) {
                        bounceAddr.writeU32(0);
                    }
                }

                // 2. 延迟销毁 — 等引擎回调栈退出后再 destroy
                const actorCopy = actor;
                setTimeout(() => {
                    try {
                        const vtable = actorCopy.readPointer();
                        const destroyFnPtr = vtable.add(VTable_K2_DestroyActor).readPointer();
                        const K2_DestroyActor = new NativeFunction(destroyFnPtr, 'void', ['pointer']);
                        K2_DestroyActor(actorCopy);
                        destroyCount++;
                        console.log(`💀 [#${destroyCount}] 子弹已拦截 @ ${actorCopy}`);
                    } catch (e) { }
                }, 0);

            } catch (e) { }
        }
    });
}

// ==================== 启动 ====================

function main() {
    console.log("[*] 子弹反弹抑制 v3 启动 (OnHit Only)");

    const waitLib = setInterval(() => {
        const lib = Process.findModuleByName("libUE4.so");
        if (lib) {
            clearInterval(waitLib);
            moduleBase = lib.base;
            GName = moduleBase.add(GName_Offset);
            console.log(`[*] libUE4 基址: ${moduleBase}`);

            hookOnHit();
            console.log("[*] OnHit Hook 安装完成，子弹碰撞时将被销毁");
        }
    }, 500);
}

setImmediate(main);
