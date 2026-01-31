/**
 * 独立脚本 - Aimbot 修复 (NOP Patch)
 * 目标: 禁用自动瞄准逻辑
 * Offset: 0x670F3F8 (来自 WriteUp)
 */

// ==================== 常量偏移 ====================
const AimbotPatch_Offset = 0x670F3F8;

// ==================== 全局状态 ====================
let moduleBase = null;

// ==================== 主逻辑 ====================

function main() {
    console.log("[*] Aimbot 修复脚本启动...");

    const waitLib = setInterval(() => {
        const lib = Process.findModuleByName("libUE4.so");
        if (lib) {
            clearInterval(waitLib);
            moduleBase = lib.base;
            console.log(`[*] libUE4 基址: ${moduleBase}`);

            patchAimbot();
        }
    }, 500);
}

function patchAimbot() {
    const patchAddr = moduleBase.add(AimbotPatch_Offset);
    console.log(`[*] Patch 目标地址: ${patchAddr}`);

    try {
        console.log("[*] Original bytes:");
        console.log(hexdump(patchAddr, { length: 16, ansi: true }));
    } catch (e) {
        console.log("[!] 无法读取原始字节: " + e.message);
    }

    Memory.protect(patchAddr, 4, "rwx");
    patchAddr.writeByteArray([0x1F, 0x20, 0x03, 0xD5]); // ARM64 NOP
    console.log("[+] 已写入 NOP 指令!");

    console.log("[*] Patched bytes:");
    console.log(hexdump(patchAddr, { length: 16, ansi: true }));
}

setImmediate(main);