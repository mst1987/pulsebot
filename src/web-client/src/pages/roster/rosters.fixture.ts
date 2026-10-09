// Small answers of /api/rosters and /api/rosters/roster for the roster page tests (#654),
// and of the editing routes (#655-#657): settings, sync, composition, options, history.
import type {
    RosterComposition, RosterDetail, RosterHead, RosterHistoryEntry, RosterMember, RosterMemberChar, RosterOptions, RosterOverview, RosterSettings, RosterSync,
} from "../../api";

export function rosterHead(over: Partial<RosterHead> = {}): RosterHead {
    return {
        id: "raid-mo-do-abc",
        name: "Raid Mo / Do",
        categoryId: "cat1",
        categoryName: "Raid Mo / Do",
        versionId: "tbc",
        versionLabel: "TBC",
        contents: ["BT", "Hyjal"],
        raids: 11,
        icon: "achievement_boss_illidan",
        mainRole: { id: "role-main", name: "Raider Mo/Do", color: "#e67e22" },
        trialRole: null,
        discordRoles: [{ id: "role-main", name: "Raider Mo/Do", color: "#e67e22" }],
        slots: { total: 25, tank: 3, healer: 7, bench: 0 },
        allowMultipleChars: false,
        source: "migration",
        counts: { core: 19, trial: 2, bench: 2, pause: 1 },
        members: 24,
        places: 21,
        roleCounts: { tank: 3, healer: 6, dps: 12, unknown: 0 },
        attendance: 84,
        attendanceCounted: 23,
        todo: { withoutRole: 2, withoutChar: 1, trial: 2 },
        ...over,
    };
}

export function overview(over: Partial<RosterOverview> = {}): RosterOverview {
    return {
        rosters: [rosterHead()],
        categoriesWithoutRoster: [{ id: "cat2", name: "PuG Karazhan", versionId: "tbc", versionLabel: "TBC" }],
        canCreate: true,
        ...over,
    };
}

export function memberChar(name: string, over: Partial<RosterMemberChar> = {}): RosterMemberChar {
    return {
        key: name.toLowerCase(), name, className: "Warrior", classColor: "#C79C6E",
        spec: "Warrior-Protection", specId: "Protection", specLabel: "Schutz", specIcon: "ability_warrior_defensivestance", iconUrl: "", role: "tank",
        ...over,
    };
}

export function member(displayName: string, over: Partial<RosterMember> = {}): RosterMember {
    return {
        userId: `u-${displayName.toLowerCase()}`,
        displayName,
        avatarUrl: "",
        onServer: true,
        status: "core",
        since: "2026-05-12T18:00:00.000Z",
        trialUntil: null,
        chars: [memberChar(displayName)],
        role: "tank",
        hasRole: true,
        heldRoles: ["role-main"],
        attendance: { attended: 9, total: 11, pct: 82, missed: [], present: [] },
        ...over,
    };
}

export function detail(members: RosterMember[], over: Partial<RosterDetail> = {}): RosterDetail {
    return {
        roster: rosterHead({ members: members.length }),
        members,
        window: 11,
        membersKnown: true,
        canManage: false,
        isAdmin: false,
        settings: null,
        ...over,
    };
}

export function settings(over: Partial<RosterSettings> = {}): RosterSettings {
    return {
        categoryId: "cat1",
        versionId: "tbc",
        roleIds: ["role-main"],
        trialRoleId: null,
        managers: { roleIds: [], userIds: ["u-marc"], users: [{ userId: "u-marc", displayName: "Marc" }] },
        signupOnly: false,
        allowMultipleChars: false,
        slots: { total: 25, tank: 3, healer: 7, bench: 0 },
        ...over,
    };
}

export function sync(over: Partial<RosterSync> = {}): RosterSync {
    return {
        rosterId: "raid-mo-do-abc",
        guildId: "g1",
        roles: [{ id: "role-main", name: "Raider Mo/Do", color: "#e67e22", main: true, trial: false, exists: true }],
        canManageRoles: true,
        membersError: null,
        inRosterWithoutRole: [],
        roleWithoutRoster: [],
        withoutChar: [],
        logCharsWithoutPerson: [],
        mirrored: [],
        canManage: true,
        ...over,
    };
}

export function composition(over: Partial<RosterComposition> = {}): RosterComposition {
    return {
        rosterId: "raid-mo-do-abc",
        versionId: "tbc",
        slots: { total: 25, tank: 3, healer: 7, bench: 2 },
        counts: { core: 19, trial: 2, bench: 2, pause: 1 },
        roles: [{ role: "tank", target: 3, actual: 3 }, { role: "healer", target: 7, actual: 6 }, { role: "dps", target: 15, actual: 12 }],
        dps: { melee: 6, ranged: 6 },
        unknown: 0,
        bench: { target: 2, actual: 2 },
        open: 4,
        classes: [{ className: "Warrior", label: "Krieger", labelEn: "Warrior", color: "#C79C6E", icon: "classicon_warrior", count: 4 }],
        buffs: [],
        buffsAvailable: true,
        canManage: false,
        ...over,
    };
}

export function options(over: Partial<RosterOptions> = {}): RosterOptions {
    return {
        guildId: "g1",
        categories: [
            { id: "cat1", name: "Raid Mo / Do", versionId: "tbc", rosterId: "raid-mo-do-abc", rosterName: "Raid Mo / Do" },
            { id: "cat2", name: "PuG Karazhan", versionId: "tbc", rosterId: null, rosterName: "" },
        ],
        versions: [{ id: "tbc", label: "WoW TBC", short: "TBC" }, { id: "forever", label: "WoW Forever", short: "Forever" }],
        defaultVersion: "tbc",
        roles: [
            { id: "role-main", name: "Raider Mo/Do", color: "#e67e22", position: 10, manageable: true },
            { id: "role-kara", name: "Kara-Team", color: "#3498db", position: 9, manageable: true },
            { id: "role-trial", name: "Probe", color: "", position: 8, manageable: true },
            { id: "role-lead", name: "Raidlead", color: "", position: 30, manageable: false },
        ],
        canManageRoles: true,
        online: true,
        kaders: [],
        templateSlots: { cat2: { total: 10, tank: 2, healer: 3, bench: 2, templateId: "kara", templateName: "Karazhan" } },
        isAdmin: true,
        ...over,
    };
}

export function historyEntry(over: Partial<RosterHistoryEntry> = {}): RosterHistoryEntry {
    return { at: "2026-10-02T18:00:00.000Z", by: "u-marc", byName: "Marc", userId: "u-thorgrim", userName: "Thorgrim", what: "member-added", detail: "core, thorgrim", ...over };
}