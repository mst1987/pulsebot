// Small roster answers for the RosterPage tests (design issue #218).
import type { CharGearReport, RosterChar, RosterData, RosterHiddenNote, RosterStats } from "../../api";

/** One character; the key is the lower-case name, the category "c1" unless given. */
export function rosterChar(character: string, over: Partial<RosterChar> = {}): RosterChar {
    return {
        key: character.toLowerCase(),
        character,
        realm: "Thunderstrike",
        categoryIds: ["c1"],
        assigned: true,
        raiderIds: [],
        lootCount: 0,
        items: [],
        className: "Mage",
        spec: "Fire",
        source: "",
        classColor: "",
        iconUrl: "",
        armoryUrl: "",
        wclUrl: "",
        gear: null,
        role: "dps",
        attendance: {},
        ...over,
    };
}

/** A gear report with `count` findings (the first one high when `high`). */
export function gearWithIssues(character: string, count: number, high = false): CharGearReport {
    return {
        character,
        className: "Mage",
        issues: Array.from({ length: count }, (_, n) => ({
            kind: "enchant",
            label: "keine Verzauberung",
            severity: high && n === 0 ? "high" as const : "medium" as const,
            itemId: String(100 + n),
            itemName: `Item ${n}`,
            slotName: "Kopf",
            slotKey: "HEAD",
            iconUrl: "",
        })),
        issueCount: count,
        reportRefId: "r1",
        reportId: "wcl1",
        reportUrl: "",
        reportTitle: "Karazhan",
        zone: "Karazhan",
        generatedAt: 0,
    };
}

export function rosterStats(over: Partial<RosterStats> = {}): RosterStats {
    return {
        total: 0, assigned: 0, fromLootOnly: 0, categories: 1, uncategorized: 0, loot: 0,
        evaluated: 0, withIssues: 0, clean: 0, issues: 0, highIssues: 0,
        avgAttendance: null, attendanceCounted: 0, classes: [],
        ...over,
    };
}

export function rosterData(chars: RosterChar[], hidden: (RosterChar & { hidden: RosterHiddenNote })[] = []): RosterData {
    return {
        chars,
        hiddenChars: hidden,
        categories: [
            { id: "c1", name: "Montagsraid" },
            { id: "c2", name: "Pug" },
        ],
        categoryInfo: {
            c1: { raids: 5, contents: ["Karazhan"], icon: "" },
            c2: { raids: 3, contents: ["Gruul"], icon: "" },
        },
        stats: rosterStats({ total: chars.length }),
        activeGuildId: "g1",
    };
}
