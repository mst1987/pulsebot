// Small, readable data for the setup editor's render tests
// (pages/raid-detail/SetupEditor*.test.tsx): raiders, a stored setup and the
// page payload of GET /api/raids/setup. Every builder takes overrides.
import type { SetupEditorData, SetupPerson, StoredSetup } from "../../api";
import type { RaidCtx } from "../../pages/raid-detail/meta";
import type { RaidDetailData } from "../../api";

export const EVENT_ID = "ev1";

export function person(userId: string, character: string, over: Partial<SetupPerson> = {}): SetupPerson {
    return {
        userId, character, classId: "mage", spec: "mage-fire", role: "ranged", main: true, status: "signed",
        locked: false, reasons: [], brings: [], name: `${character.toLowerCase()}#discord`,
        classColor: "#3fc7eb", classLabel: "Magier", specLabel: "Feuer", specIcon: "spell_fire_firebolt02",
        ...over,
    };
}

export function storedSetup(over: Partial<StoredSetup> = {}): StoredSetup {
    return {
        status: "draft", version: 3, origin: "proposal",
        groups: [], bench: [],
        checks: {
            ok: true,
            size: { count: 0, size: 25, ok: true },
            roles: {
                tank: { count: 1, min: 2, max: 2, ok: false },
                healer: { count: 1, min: 5, max: 6, ok: false },
                melee: { count: 1, min: 0, max: null, ok: true },
                ranged: { count: 2, min: 0, max: null, ok: true },
            },
            buffs: { ok: true, required: [], raid: [], party: [] },
            wishes: { met: 0, total: 0 },
        },
        weights: {}, score: { total: 0 }, warnings: [], historySource: "",
        options: { weights: {}, fairness: false, wishes: false },
        updatedAt: 0, approvedAt: 0, approvedBy: "", changedSinceApproval: false, approved: null, explanation: null,
        ...over,
    };
}

/** The four raiders of the default lineup: two in group 1, one in group 2, one on the bench. */
export const TANK = person("u-tank", "Bruno", { classId: "warrior", spec: "warrior-protection", role: "tank", classLabel: "Krieger", specLabel: "Schutz", classColor: "#c69b6d" });
export const MAGE = person("u-mage", "Ignis", { reasons: ["Hauptspec", "Bringt Arkane Brillanz"] });
export const PRIEST = person("u-priest", "Lumen", { classId: "priest", spec: "priest-holy", role: "healer", classLabel: "Priester", specLabel: "Heilig", classColor: "#ffffff" });
export const ROGUE = person("u-rogue", "Schatten", { classId: "rogue", spec: "rogue-combat", role: "melee", classLabel: "Schurke", specLabel: "Kampf", classColor: "#fff468" });

export function lineup(): Pick<StoredSetup, "groups" | "bench"> {
    return {
        groups: [
            { index: 1, slots: [{ ...TANK, pos: 1 }, { ...MAGE, pos: 2 }] },
            { index: 2, slots: [{ ...PRIEST, pos: 1 }] },
        ],
        bench: [ROGUE],
    };
}

export function editorData(over: Partial<SetupEditorData> = {}, setup: Partial<StoredSetup> = {}): SetupEditorData {
    return {
        eventId: EVENT_ID,
        event: { id: EVENT_ID, title: "Karazhan Donnerstag", startTime: 0, size: 25, composition: { tank: 2, healer: 5, melee: 0, ranged: 0 }, versionId: "tbc", fairness: false, wishes: false },
        canWrite: true,
        approved: null,
        setup: storedSetup({ ...lineup(), ...setup }),
        groupCount: 5,
        attendance: {},
        signupCount: 4,
        absent: 0,
        avoidPairs: 0,
        defaults: { weights: { requiredBuffs: 100 }, maxWeight: 500 },
        hasApiKey: false,
        pingText: "Setup steht!",
        extraRoles: {},
        search: null,
        ...over,
    };
}

/** The part of the raid-detail page context the setup tab reads. */
export function setupCtx(over: Partial<RaidCtx> = {}): RaidCtx {
    return {
        data: {} as RaidDetailData,
        eventId: EVENT_ID,
        onChanged: () => {},
        openModal: () => {},
        openPlayer: () => {},
        canManage: true,
        ...over,
    };
}
