import { get, send } from "./client";
import type { ApiError } from "./client";
import type { ItemSearchResult } from "./settings";

// ── Loot-Council ─────────────────────────────────────────────────────────────
// The caster council view (src/web/apiRoutes/lootCouncil.js). Two speeds: the
// page itself comes from stored data in one call, the DPS simulation runs as a
// background job the client polls.

/** One item a raider was awarded, as the council list shows it. */
export type CouncilLootItem = {
    itemId: number;
    itemName: string;
    itemIconUrl: string;
    itemQuality: number | null;
    /** Equip slot (WCL numbering, the first of a doubled one); -1 when unknown. */
    slot: number;
    slotName: string;
    contentId: string;
    tier: string;
    boss: string;
    reason: string;
    reasonLabel: string;
    reasonTone: string;
    awardedAt: number;
    eventLabel: string;
};

/**
 * One piece a raider currently wears, as the gear row under their name and the
 * "Slot" column of the candidate list render it. Name and icon come from the
 * log (it saw what they actually wear); stats and raid come from the item table
 * where it knows the item.
 */
export type WornItem = {
    slot: number;
    slotName: string;
    itemId: number;
    itemName: string;
    iconUrl: string;
    quality: number | null;
    itemLevel: number;
    stats: Record<string, number>;
    contentId: string;
    boss: string;
    gemCount: number;
    /** Socketed gem ids and the enchant id, for the Wowhead tooltip. */
    gemIds: number[];
    enchantId: number;
    emptySockets: number;
    /** "ok" | "missing" | "bad" | "na" — "missing" is the one worth showing. */
    enchantStatus: string;
    /** Whether this piece is on that raider's own BiS list. */
    isBis: boolean;
    /** ...and whose lists it is on at all. */
    bisSpecs: BisSpec[];
    /**
     * Set when the piece only pays off against certain bosses (Mark of the
     * Champion and its like) and no older raid showed what they wear otherwise.
     * Every comparison reads such a slot as empty, so it has to be marked.
     */
    situational: { note: string } | null;
    /**
     * The other side of the same coin: this piece was taken from an older raid
     * because the newest one had a boss-specific item in the slot. Says what it
     * stands in for, and where it comes from.
     */
    replacedSituational: {
        itemId: number;
        itemName: string;
        iconUrl: string;
        note: string;
        seenAt: number;
        reportTitle: string;
        /**
         * The best case: the substitute is from the *same* raid, one boss away
         * — the evaluation walked the fights and found what they wore when the
         * boss-specific piece was off. Then `fight` names that boss and
         * `seenAt`/`reportTitle` are empty, because it is not an older set.
         */
        sameRaid?: boolean;
        fight?: string;
    } | null;
};

/**
 * A spec that has a given item on its BiS list.
 *
 * "BiS" on its own says nothing when nine specs share one item table — most
 * caster drops are contested — so every item carries whose list it is on.
 * `alsoFor` names the specs that borrow this one's list (WoWSims ships none of
 * their own), which is an assumption and shown as one.
 */
export type BisSpec = {
    specKey: string;
    label: string;
    iconUrl: string;
    classColor: string;
    role: string;
    tier: string;
    alsoFor: string[];
};

/** An item as the BiS list and the candidate view render it. */
export type CouncilItem = {
    id: number;
    name: string;
    iconUrl: string;
    ilvl: number;
    quality: number;
    stats: Record<string, number>;
    setName?: string;
    contentId: string;
    boss: string;
    /** Which specs have it on their BiS list for the tier being measured. */
    bisSpecs: BisSpec[];
    owned?: boolean;
};

/** What one raider would gain from one item. */
export type CouncilCandidate = {
    key: string;
    character: string;
    classColor: string;
    specKey: string;
    specLabel: string;
    specIconUrl: string;
    slot: number;
    slotName: string;
    /** What would come off — null when the slot is free. */
    replaces: WornItem | null;
    /**
     * Every slot the item could go in, with what sits there. Two rings, two
     * trinkets, or both hands for a two-hander; `chosen` marks where it lands
     * (both, for a two-hander, since it takes both).
     */
    slotOptions: { slot: number; slotName: string; chosen: boolean; item: WornItem | null }[];
    /** True when accepting it also costs the off-hand piece. */
    twoHanded: boolean;
    /**
     * Stat-weight value of the swap — the server's *ordering* while nothing is
     * simulated, never shown as a number: the page shows measured gains only.
     */
    value: number;
    /**
     * Why this raider's gain is not comparable to the others': what would come
     * off carries no caster stats at all, so the comparison measures against an
     * empty slot and credits them the item's full worth. Empty in the normal
     * case.
     */
    inflatedBy: { itemName: string; note: string }[];
    isBis: boolean;
    /** 1 when the item is on this raider's BiS list, else the server's non-BiS weight (0.5). */
    bisWeight: number;
    /** needScore × bisWeight: the need as it counts for this item. */
    itemNeedScore: number;
    /** The fairness half — the same numbers the roster table shows. */
    needScore: number;
    needParts: { drought: number; share: number; need: number };
    lootCount: number;
    lootTotal: number;
    /** See CouncilRaider.otherCount — off-spec, shards, bank. */
    otherCount: number;
    /** Their newest awards, so the loot count can be opened in a hover. */
    recentItems: CouncilLootItem[];
    daysSinceLoot: number | null;
    lastAwardAt: number;
    bisOwned: number;
    bisTotal: number;
    hasGear: boolean;
    simSupported: boolean;
    /** The full worn set and where it comes from — same shape as CouncilRaider's, so the drop check can show it inline. */
    gear: CouncilRaider["gear"];
};

/**
 * A raider who cannot equip the item at all — a warlock's tier helm for a
 * mage, a mail chest for a priest, a two-hander for a rogue. Never a
 * candidate; listed with the reason so a short list is explained.
 */
export type CouncilUnwearable = {
    key: string;
    character: string;
    classColor: string;
    specKey: string;
    specLabel: string;
    specIconUrl: string;
    /** "class" | "armor" | "weapon" | "ranged" */
    reason: string;
    /** The short German reason, e.g. "Kette — Magier trägt nur Stoff". */
    note: string;
};

/** The picked drop: the item, who could take it, who cannot. */
export type CouncilFocus = {
    item: CouncilItem;
    candidates: CouncilCandidate[];
    unwearable: CouncilUnwearable[];
};

export type CouncilRaider = {
    key: string;
    character: string;
    className: string;
    classColor: string;
    specIconUrl: string;
    spec: string;
    specKey: string;
    specLabel: string;
    /** True when the spec was assumed from the class (a mage is always a caster). */
    specAssumed: boolean;
    /** Their armory page, for checking the gear this page derived from a log. */
    armoryUrl: string;
    role: "caster" | "healer";
    /**
     * Als was der Raidlead sie eingeplant hat ("" = wie in den Daten). Ein
     * Heiler im Offspec ist für diesen Abend ein DPS, und das steht nirgends in
     * den Daten — also wird es festgelegt.
     */
    roleOverride: string;
    /** Was die Daten sagen: die Spec, mit der sie zuletzt geloggt wurden. */
    roleFromData: string;
    /** Welche Rollen ihre Klasse spielen kann. Eine = nichts zu wählen. */
    roleOptions: string[];
    /** Items in the current content filter; lootTotal counts all of them. */
    lootCount: number;
    lootTotal: number;
    /**
     * Off-spec rolls, shards and bank items. Deliberately *not* part of
     * lootCount: they did nothing for the raider's set, and counting them would
     * rank somebody who took three shards above one real upgrade.
     */
    otherCount: number;
    lastAwardAt: number;
    daysSinceLoot: number | null;
    items: CouncilLootItem[];
    gear: {
        seenAt: number;
        reportId: string;
        reportTitle: string;
        itemCount: number;
        spellHit: number;
        hitCap: number;
        /**
         * Whether the set read out of the log is this raider's damage kit or
         * their healing one ("caster" | "healer" | "" when too little is known).
         * Shamans and druids heal a night regularly, and judging them on that
         * set would mean no DPS and drops "replacing" healing pieces.
         */
        setRole: string;
        /** False when the two signals (heal ratio, spell hit) disagree. */
        setConfident: boolean;
        /** Every recent log showed the wrong role — the numbers are off. */
        roleMismatch: boolean;
        /** Newer raids skipped to find a set of the right role. */
        skippedReports: number;
        /**
         * Where this set comes from: "log" — the last evaluation, "wcl" — a
         * Warcraft-Logs report somebody loaded for this raider, "armory" —
         * what the character has on now, because somebody pressed the button.
         */
        source: "log" | "wcl" | "armory";
        /** When the armory answered (0 for a log set). */
        armoryAt: number;
        /** When the loaded log was fetched (0 unless source is "wcl"). */
        wclAt: number;
        /**
         * A log was loaded for this raider but not taken: "pvp" — an arena
         * set, "role" — the other role's set. The evaluation's set stays.
         */
        logRejected: "" | "pvp" | "role";
        /**
         * Why the armory's answer was *not* taken although there is one:
         * "pvp" — the character is in arena gear right now, which makes no
         * sense against a boss; "role" — a healing set for a raider judged as
         * a caster. The last raid's set stays in both cases.
         */
        armoryRejected: "" | "pvp" | "role";
        /** Every recent log showed PvP gear, so this set is one — and says so. */
        pvpGear: boolean;
        /**
         * Pieces that are new since the last raid: the armory names the item,
         * but its enchant ids are not the ones WoWSims uses, so no enchant is
         * claimed for them and the simulation runs them unenchanted.
         */
        unverifiedEnchants: number;
        /** Slots still held by a boss-specific piece the comparison reads as empty. */
        situational: number;
        /** Slots filled from another source (armory, another boss, an older raid). */
        substituted: number;
        /**
         * Boss-specific pieces taken out of the set entirely, because no source
         * could say what the raider wears there otherwise. Those slots count as
         * empty — which is what they are worth against every boss the council
         * plans for — and the page names them.
         */
        dropped: {
            slot: number;
            slotName: string;
            itemId: number;
            itemName: string;
            iconUrl: string;
            note: string;
        }[];
        /** Everything they wear, in character-sheet order. */
        items: WornItem[];
    } | null;
    bis: {
        tier: string;
        /** False when the list is from an earlier tier than the one asked for. */
        exact: boolean;
        /** Set when the list belongs to another spec (Fire mage borrows Arcane). */
        borrowedFrom: string;
        /** "wowsims" (simulated loadout) or "wowhead" (written, items only). */
        source: string;
        sourceLabel: string;
        total: number;
        owned: number;
        items: CouncilItem[];
    };
    simSupported: boolean;
    /** 0..1, higher = more due for an item. needParts shows what it is made of. */
    needScore: number;
    needParts: { drought: number; share: number; need: number };
};

export type CouncilGap = CouncilItem & {
    wantedBy: { key: string; character: string; specKey: string; specLabel: string; needScore: number }[];
    candidates: CouncilCandidate[];
    best: CouncilCandidate | null;
};

export type CouncilFilterOptions = {
    roles: { id: string; label: string }[];
    tiers: { id: string; label: string }[];
    contents: { id: string; label: string; short: string; tier: string }[];
    bisTiers: { id: string; label: string }[];
    categories: { id: string; name: string }[];
};

/** A raider the council has stopped planning with. */
export type ExcludedRaider = {
    key: string;
    character: string;
    reason: string;
    at: number;
    by: string;
};

/** One of the bot's newest logs, offered at a raider to load their gear from. */
export type CouncilLog = {
    reportId: string;
    title: string;
    postedAt: number;
    eventLabel: string;
    link: string;
};

export type LootCouncilData = {
    roster: CouncilRaider[];
    avgLootCount: number;
    recentLogs: CouncilLog[];
    /** Set aside, and offerable back. */
    excluded: ExcludedRaider[];
    gaps: CouncilGap[];
    focus: CouncilFocus | null;
    options: CouncilFilterOptions;
    filter: {
        role: string; tierIds: string[]; contentIds: string[]; categoryId: string;
        /** The BiS list actually measured against. */
        bisTier: string;
        /** True when nobody picked one and it came from the guild's newest loot. */
        bisTierDerived: boolean;
        /** How many raiders each filter removed — so a short list is explained. */
        skipped: { category: number; excluded: number };
        /**
         * What each source contributed to "who raids this category" — the logs
         * of its raids, the loot awarded there, and the maintained
         * raider→character assignment. All three zero means the filter found
         * nobody, which is why the list is empty; the page uses this to say
         * what to fix. null when no category is picked.
         */
        categorySources: { reports: number; loot: number; assigned: number } | null;
    };
    sim: { available: boolean; version: string; hint: string };
    activeGuildId: string;
};

export type CouncilFilter = {
    role?: string;
    tiers?: string[];
    contents?: string[];
    category?: string;
    bisTier?: string;
    item?: number;
};

export function getLootCouncil(filter: CouncilFilter = {}): Promise<LootCouncilData> {
    const params = new URLSearchParams();
    if (filter.role) params.set("role", filter.role);
    if (filter.tiers && filter.tiers.length) params.set("tiers", filter.tiers.join(","));
    if (filter.contents && filter.contents.length) params.set("contents", filter.contents.join(","));
    if (filter.category) params.set("category", filter.category);
    if (filter.bisTier) params.set("bisTier", filter.bisTier);
    if (filter.item) params.set("item", String(filter.item));
    const qs = params.toString();
    return get<LootCouncilData>(`/api/lootcouncil${qs ? `?${qs}` : ""}`);
}

/** Per raider: their simulated DPS, and what each candidate item would add. */
export type SimResult = Record<string, {
    baseline: number | null;
    hasGear: boolean;
    error?: string;
    items: Record<string, { dps: number | null; delta: number | null; slot: number; cached: boolean; error?: string }>;
}>;

export type SimJob = {
    status: "running" | "done" | "error" | "unknown";
    progress?: number;
    total?: number;
    available?: boolean;
    result?: SimResult | null;
    error?: string;
};

export function startCouncilSim(
    id: string,
    subjects: { key: string; specKey: string }[],
    items: number[],
): Promise<{ status: string; alreadyRunning: boolean; id: string }> {
    return send("POST", "/api/lootcouncil/sim", { id, subjects, items });
}

export function getCouncilSim(id: string): Promise<SimJob> {
    return get<SimJob>(`/api/lootcouncil/sim?id=${encodeURIComponent(id)}`);
}

/**
 * Start a council simulation and poll it to the end.
 *
 * Its own poll loop rather than pollJob(): a sim job reports progress the page
 * shows while it runs ("7 von 24"), and pollJob only distinguishes running from
 * done. `onProgress` is called on every poll.
 */
export async function runCouncilSim(
    id: string,
    subjects: { key: string; specKey: string }[],
    items: number[],
    onProgress?: (job: SimJob) => void,
): Promise<SimResult> {
    await startCouncilSim(id, subjects, items);
    const startedAt = Date.now();
    const POLL_MS = 1500;
    // One raider is ~1s per item; a whole roster against a full BiS gap list is
    // the worst case this has to survive.
    const TIMEOUT_MS = 15 * 60 * 1000;
    for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const job = await getCouncilSim(id);
        if (onProgress) onProgress(job);
        if (job.status === "done") return job.result || {};
        if (job.status === "error") throw { code: "sim_failed", message: job.error || "Simulation fehlgeschlagen." } as ApiError;
        if (job.status === "unknown") throw { code: "sim_lost", message: "Die Simulation wurde unterbrochen. Bitte erneut starten." } as ApiError;
        if (Date.now() - startedAt > TIMEOUT_MS) {
            throw { code: "sim_timeout", message: "Die Simulation dauert ungewöhnlich lange. Bitte später erneut versuchen." } as ApiError;
        }
    }
}

/**
 * Items for the "this just dropped" picker.
 *
 * Searched in the bot's own caster item table, not on Wowhead: it answers
 * instantly, only offers items a caster can be handed, and every hit is
 * guaranteed to resolve to a slot and a stat block — which is what the
 * candidate list needs. Same result shape as the other item pickers, so
 * ItemSearchPicker takes it as-is.
 */
export function searchCouncilItems(q: string, tier = ""): Promise<{ items: CouncilItemHit[] }> {
    const qs = new URLSearchParams({ q });
    if (tier) qs.set("tier", tier);
    return get<{ items: CouncilItemHit[] }>(`/api/lootcouncil/item-search?${qs.toString()}`);
}

/**
 * A search hit, with the answer to the other direction on it: whose BiS list is
 * this piece on? An empty `bisSpecs` is that answer, not a missing field — most
 * items are on nobody's list.
 */
export type CouncilItemHit = ItemSearchResult & {
    /** The caster table knows the item level; the Wowhead pickers do not. */
    ilvl?: number;
    contentId: string;
    boss: string;
    bisSpecs: BisSpec[];
};

/** Which gear set is BiS for which caster DPS class and spec, as a matrix. */
export type BisListsData = {
    tier: string;
    /** Every tier, with the lists it has no set for (SWP has none for Shadow/Arcane). */
    tiers: { id: string; label: string; missing: string[] }[];
    /** Every caster and healer spec — including those that borrow a list. */
    specs: {
        key: string;
        label: string;
        className: string;
        spec: string;
        role: string;
        iconUrl: string;
        classColor: string;
        /** Whose list this spec plays. */
        listKey: string;
        ownList: boolean;
    }[];
    /** One column per list, carrying everyone who plays it. */
    columns: {
        key: string;
        label: string;
        iconUrl: string;
        classColor: string;
        role: string;
        /**
         * Where the list comes from: "wowsims" is a simulated loadout with gems
         * and enchants, "wowhead" a written recommendation naming items only.
         */
        source: string;
        sourceLabel: string;
        users: { key: string; label: string; ownList: boolean }[];
    }[];
    rows: {
        slot: number;
        slotName: string;
        cells: {
            column: string;
            item: CouncilItem | null;
            /** Sockets and enchant of the WoWSims reference set. */
            gems?: number;
            enchanted?: boolean;
            /** How many of the tier's lists want this item. */
            shared?: number;
        }[];
    }[];
    contested: number;
};

export function getBisLists(tier: string): Promise<BisListsData> {
    const qs = tier ? `?tier=${encodeURIComponent(tier)}` : "";
    return get<BisListsData>(`/api/lootcouncil/bislists${qs}`);
}

/**
 * Stop planning with a raider, or resume.
 *
 * Never deletes anything: the loot history stays whole, the raider simply drops
 * out of the roster and the candidate lists until somebody takes them back in.
 */
export function setCouncilExcluded(
    character: string,
    excluded: boolean,
    reason = "",
): Promise<{ character: string; excluded: boolean }> {
    return send("POST", "/api/lootcouncil/exclude", { character, exclude: excluded, reason });
}

/**
 * Als was ein Raider eingeplant ist. Ein leeres `role` nimmt die Festlegung
 * zurück, und die Seite folgt wieder dem, was die Daten sagen.
 */
export function setCouncilRole(
    character: string,
    role: "" | "caster" | "healer",
): Promise<{ character: string; role: string }> {
    return send("POST", "/api/lootcouncil/role", { character, role });
}

/**
 * Fetch these raiders' current gear from the armory.
 *
 * A button, not a page load: it is one call per raider to an API outside this
 * app, and "nimm den Stand von jetzt" is a decision the reader makes. The
 * council data has to be reloaded afterwards to show it.
 */
export function refreshCouncilArmory(
    characters: string[],
): Promise<{ asked: number; answered: number; configured: boolean }> {
    return send("POST", "/api/lootcouncil/armory", { characters });
}

/**
 * Load one raider's gear from a Warcraft-Logs report (one of the bot's logs by
 * id, any report by link, or — with neither — the newest log they are in), or
 * forget a loaded one with `clear`. The council data has to be reloaded
 * afterwards to show it.
 */
export function loadCouncilLogGear(
    body: { character: string; reportId?: string; link?: string; clear?: boolean },
): Promise<{ cleared?: boolean; reportId?: string; reportTitle?: string; reportStart?: number; items?: number; tried?: number }> {
    return send("POST", "/api/lootcouncil/loggear", body);
}

/**
 * A raider's loadout as a WoWSims "From JSON" import.
 *
 * Built from the same pieces as the page's own simulation — gear, talents, spec
 * options, rotation, consumables, buffs, encounter — so pasting it into
 * wowsims.github.io/tbc reproduces the number shown here. An export that
 * quietly differed would make the page look wrong when it is not.
 */
export type CouncilExport = {
    character: string;
    spec: string;
    specLabel: string;
    /** The WoWSims page it belongs on — the import does not switch class itself. */
    simUrl: string;
    seenAt: number;
    reportTitle: string;
    warnings: string[];
    json: string;
};

export function getCouncilExport(character: string): Promise<CouncilExport> {
    return get<CouncilExport>(`/api/lootcouncil/export?character=${encodeURIComponent(character)}`);
}
