// Loot council data for the client tests (pages/lootcouncil/*.test.tsx): one
// caster raider with a worn set, a BiS gap with its candidate, and the filter
// options the page renders — the smallest payload every part of the page draws.
import type { BisListsData, CouncilCandidate, CouncilFocus, CouncilItem, CouncilRaider, LootCouncilData, WornItem } from "../api";

export function wornItem(over: Partial<WornItem> = {}): WornItem {
    return {
        slot: 0, slotName: "Kopf", itemId: 100, itemName: "Hood of Test", iconUrl: "", quality: 4, itemLevel: 128,
        stats: {}, contentId: "kara", boss: "Prince", gemCount: 1, gemIds: [], enchantId: 0, emptySockets: 1,
        enchantStatus: "missing", isBis: false, bisSpecs: [], situational: null, replacedSituational: null,
        ...over,
    };
}

export function councilItem(over: Partial<CouncilItem> = {}): CouncilItem {
    return {
        id: 200, name: "Staff of Test", iconUrl: "", ilvl: 141, quality: 4, stats: {}, contentId: "ssc", boss: "Vashj",
        bisSpecs: [], owned: false,
        ...over,
    };
}

export function councilRaider(over: Partial<CouncilRaider> = {}): CouncilRaider {
    return {
        key: "anna", character: "Anna", className: "Mage", classColor: "#69ccf0", specIconUrl: "", spec: "Arcane",
        specKey: "mage-arcane", specLabel: "Arkan", specAssumed: false, armoryUrl: "", role: "caster",
        roleOverride: "", roleFromData: "caster", roleOptions: ["caster"],
        lootCount: 2, lootTotal: 3, otherCount: 0, lastAwardAt: 0, daysSinceLoot: null, items: [],
        gear: {
            seenAt: 1_700_000_000_000, reportId: "r1", reportTitle: "SSC Mittwoch", itemCount: 1, spellHit: 150, hitCap: 202,
            setRole: "caster", setConfident: true, roleMismatch: false, skippedReports: 0, source: "log",
            armoryAt: 0, wclAt: 0, logRejected: "", armoryRejected: "", pvpGear: false, unverifiedEnchants: 0,
            situational: 0, substituted: 0, dropped: [], items: [wornItem()],
        },
        bis: {
            tier: "t5", exact: true, borrowedFrom: "", source: "wowsims", sourceLabel: "WoWSims", total: 2, owned: 1,
            items: [councilItem({ owned: false })],
        },
        simSupported: true,
        needScore: 0.5,
        needParts: { drought: 0.5, share: 0.5, need: 0.5 },
        ...over,
    };
}

export function councilCandidate(over: Partial<CouncilCandidate> = {}): CouncilCandidate {
    const r = councilRaider();
    return {
        key: r.key, character: r.character, classColor: r.classColor, specKey: r.specKey, specLabel: r.specLabel,
        specIconUrl: "", slot: 15, slotName: "Waffenhand", replaces: null,
        slotOptions: [], twoHanded: false, value: 0, inflatedBy: [], isBis: true, bisWeight: 1, itemNeedScore: 0.5,
        needScore: 0.5, needParts: r.needParts, lootCount: 2, lootTotal: 3, otherCount: 0, recentItems: [],
        daysSinceLoot: null, lastAwardAt: 0, bisOwned: 1, bisTotal: 2, hasGear: true, simSupported: true, gear: r.gear,
        ...over,
    };
}

export function councilFocus(over: Partial<CouncilFocus> = {}): CouncilFocus {
    return { item: councilItem(), candidates: [councilCandidate()], unwearable: [], ...over };
}

export function councilData(over: Partial<LootCouncilData> = {}): LootCouncilData {
    const item = councilItem();
    return {
        roster: [councilRaider()],
        avgLootCount: 2,
        recentLogs: [],
        excluded: [],
        gaps: [{ ...item, wantedBy: [{ key: "anna", character: "Anna", specKey: "mage-arcane", specLabel: "Arkan", needScore: 0.5 }], candidates: [councilCandidate()], best: null }],
        focus: null,
        options: {
            roles: [{ id: "caster", label: "Caster" }, { id: "healer", label: "Heiler" }],
            tiers: [{ id: "t5", label: "T5" }],
            contents: [{ id: "ssc", label: "Serpentshrine Cavern", short: "SSC", tier: "t5" }],
            bisTiers: [{ id: "t5", label: "T5" }],
            categories: [],
        },
        filter: {
            role: "caster", tierIds: [], contentIds: [], categoryId: "", bisTier: "t5", bisTierDerived: false,
            skipped: { category: 0, excluded: 0 }, categorySources: null,
        },
        sim: { available: true, version: "1.0", hint: "" },
        activeGuildId: "g1",
        ...over,
    };
}

export function bisListsData(): BisListsData {
    return {
        tier: "t5",
        tiers: [{ id: "t5", label: "T5", missing: [] }],
        specs: [{ key: "mage-arcane", label: "Arkan", className: "Mage", spec: "Arcane", role: "caster", iconUrl: "", classColor: "#69ccf0", listKey: "mage-arcane", ownList: true }],
        columns: [{ key: "mage-arcane", label: "Arkan", iconUrl: "", classColor: "#69ccf0", role: "caster", source: "wowsims", sourceLabel: "WoWSims", users: [{ key: "mage-arcane", label: "Arkan", ownList: true }] }],
        rows: [{ slot: 15, slotName: "Waffenhand", cells: [{ column: "mage-arcane", item: councilItem(), gems: 0, enchanted: true, shared: 1 }] }],
        contested: 0,
    };
}
