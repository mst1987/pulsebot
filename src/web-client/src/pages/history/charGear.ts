import type { GearItem } from "../../api";
import { wowheadItemUrl } from "../../lib/wowheadItems";
import { t } from "../../i18n";

// Character-sheet order in two columns, weapons underneath. Shirt and tabard
// are left out: they take a slot on the sheet and carry no raid value.
export const GEAR_LEFT = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "WRIST"];

export const GEAR_RIGHT = ["HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2"];

export const GEAR_BOTTOM = ["MAIN_HAND", "OFF_HAND", "RANGED"];

export const NO_RAID_VALUE = new Set(["SHIRT", "TABARD"]);

// Socket colour names. Getters, so every read is in the active language.
export const SOCKET_DE: Record<string, string> = {
    get RED() { return t("history.sockets.red"); },
    get YELLOW() { return t("history.sockets.yellow"); },
    get BLUE() { return t("history.sockets.blue"); },
    get META() { return t("history.sockets.meta"); },
    get PRISMATIC() { return t("history.sockets.prismatic"); },
};

// The game's own empty-socket art (same files Wowhead's tooltips use).
const SOCKET_ICON: Record<string, string> = {
    RED: "socket-red", YELLOW: "socket-yellow", BLUE: "socket-blue", META: "socket-meta", PRISMATIC: "socket-prismatic",
};

export function socketIconUrl(type: string): string {
    return `https://wow.zamimg.com/images/icons/${SOCKET_ICON[type] || SOCKET_ICON.PRISMATIC}.gif`;
}

// Slots that can carry a permanent enchant in TBC — same set as the CLA's gear
// audit (config/claData.js ENCHANTABLE_SLOTS), in Blizzard slot keys. Rings are
// enchanter-only, so a missing mark there would be a false alarm.
const ENCHANTABLE_SLOTS = new Set(["HEAD", "SHOULDER", "CHEST", "LEGS", "FEET", "WRIST", "HANDS", "BACK", "MAIN_HAND", "OFF_HAND"]);

// An off-hand *held* item (tome, orb) takes no enchant — only shields and
// off-hand weapons do. Same heuristic as the CLA (gearIssues.js's isShieldMisc).
export function isEnchantable(g: GearItem, slot: string): boolean {
    if (!ENCHANTABLE_SLOTS.has(slot)) return false;
    if (slot === "OFF_HAND" && g.iconUrl.indexOf("_misc_") > -1) return false;
    return true;
}

// Wowhead item URL carrying the character's actual enchant + gems.
export function gearWowheadUrl(g: GearItem): string {
    // an empty slot has no item page (the modal only links an item with an id)
    if (g.itemId === null) return "";
    const params: string[] = [];
    if (g.enchantIds.length) params.push(`ench=${g.enchantIds[0]}`);
    const gemIds = g.sockets.map((s) => s.gemId).filter((id): id is number => !!id);
    if (gemIds.length) params.push(`gems=${gemIds.join(":")}`);
    return wowheadItemUrl(g.itemId, params);
}
