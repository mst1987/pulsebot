// Small answers of /api/rosters and /api/rosters/roster for the roster page tests (#654).
import type { RosterDetail, RosterHead, RosterMember, RosterMemberChar, RosterOverview } from "../../api";

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
        ...over,
    };
}
