// A guild bank as GET /api/guildbank answers it, for the page's tests.
import type { GuildBank, GuildBankItem, GuildBankPageData } from "../../api";

export function bankItem(over: Partial<GuildBankItem> = {}): GuildBankItem {
    return {
        itemId: 1, count: 10, tabs: { 2: 10 }, totalCount: 10, allTabs: { 2: 10 }, tabHidden: false,
        status: "give", reserve: 0, maxPerRequest: 0, category: "", firstSeenAt: 1,
        name: "Klobiger lebendiger Rubin", icon: "inv_jewelcrafting_livingruby_03", iconUrl: "https://example.test/ruby.jpg",
        quality: 3, classId: 3, subclassId: 0, className: "Edelsteine", subclassName: "Rot", metaSource: "wowhead",
        reserved: 0, available: 10, group: "Edelsteine", autoGroup: "Edelsteine",
        ...over,
    };
}

export function bankData(over: Partial<GuildBank> = {}, banks?: GuildBankPageData["banks"]): GuildBankPageData {
    const bank: GuildBank = {
        key: "tbc:spineshatter:die gilde", gameVersion: "tbc", versionShort: "TBC", realm: "Spineshatter", guild: "Die Gilde",
        faction: "Alliance", guildId: "g1", pending: false, scannedAt: Date.UTC(2026, 9, 6, 16, 42), scannedBy: "Gemli",
        money: 48120000, uploadedBy: "PC", wowheadPath: "tbc", reservedRequests: 3,
        tabs: [{ index: 2, name: "Edelsteine", inScan: true, hidden: false }, { index: 3, name: "Raid", inScan: true, hidden: false }, { index: 5, name: "Lager", inScan: true, hidden: true }],
        items: [
            bankItem({ itemId: 1, reserved: 4, available: 6, count: 10 }),
            bankItem({ itemId: 2, name: "Glatter Dämmerstein", reserved: 0, reserve: 0, count: 2, available: 2 }),
            bankItem({
                itemId: 3, name: "Fläschchen des unerbittlichen Angriffs", quality: 1, tabs: { 3: 40 }, allTabs: { 3: 40 },
                count: 40, reserved: 20, reserve: 20, available: 0, group: "Fläschchen", autoGroup: "Fläschchen", classId: 0,
            }),
            bankItem({ itemId: 4, name: "Urmacht", status: "show", group: "Handwerk", autoGroup: "Elementar", category: "Handwerk" }),
            bankItem({ itemId: 5, name: "Netherstoff", status: "hide", group: "Stoff", autoGroup: "Stoff" }),
            bankItem({ itemId: 6, name: "Heldentrank", status: "new", group: "Trank", autoGroup: "Trank", tabs: { 3: 15 }, allTabs: { 3: 15 } }),
            bankItem({ itemId: 7, name: "Schattenstoff", status: "new", tabHidden: true, count: 0, tabs: {}, allTabs: { 5: 3 }, totalCount: 3 }),
        ],
        ...over,
    };
    return { banks: banks || [{ key: bank.key, gameVersion: bank.gameVersion, versionShort: bank.versionShort, realm: bank.realm, guild: bank.guild, scannedAt: bank.scannedAt }], bank };
}
