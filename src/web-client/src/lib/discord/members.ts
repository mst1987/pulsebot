import type { MemberCharacter, MemberRole, MemberRoster, ServerMember } from "../../api";
import { CLASS_COLOR } from "../raidplan/assign/classRefs";
import { versionLabel } from "../raidplan/versions";
import { formatWith } from "../format";

// System › Discord › Mitglieder (pages/channels/MembersPage.tsx): which members a
// filter keeps, what a column sorts by, how many roles a cell shows and what the
// roster column says. Kept out of the page so it stays a pure component module.

export type MemberFilter = {
    query: string;
    /** "" = every role */
    roleId: string;
    noRole: boolean;
    notInRoster: boolean;
    hideBots: boolean;
};

export const NO_FILTER: MemberFilter = { query: "", roleId: "", noRole: false, notInRoster: false, hideBots: true };

/** Whether a member matches the search: display name, Discord name or one of its characters. */
export function matchesQuery(m: ServerMember, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return m.name.toLowerCase().includes(q)
        || m.username.toLowerCase().includes(q)
        || m.characters.some((c) => c.name.toLowerCase().includes(q));
}

/** Not in any open roster (a bot never counts: it is no raider). */
export function isOutsideRoster(m: ServerMember): boolean {
    return !m.bot && m.rosters.length === 0;
}

/** The members a filter keeps, in the order given. */
export function filterMembers(members: ServerMember[], f: MemberFilter): ServerMember[] {
    return members.filter((m) => {
        if (f.hideBots && m.bot) return false;
        if (f.noRole && m.roleIds.length > 0) return false;
        if (f.notInRoster && !isOutsideRoster(m)) return false;
        if (f.roleId && !m.roleIds.includes(f.roleId)) return false;
        return matchesQuery(m, f.query);
    });
}

/** How many a switch would leave, next to its label: counted among the members bots aside unless they are shown. */
export function filterCounts(members: ServerMember[], hideBots: boolean): { noRole: number; notInRoster: number; bots: number } {
    const pool = hideBots ? members.filter((m) => !m.bot) : members;
    return {
        noRole: pool.filter((m) => m.roleIds.length === 0).length,
        notInRoster: pool.filter(isOutsideRoster).length,
        bots: members.filter((m) => m.bot).length,
    };
}

export type MemberSortKey = "name" | "roles" | "joined" | "roster";
export const MEMBER_SORT_DEFAULTS: Record<MemberSortKey, "asc" | "desc"> = { name: "asc", roles: "desc", joined: "desc", roster: "asc" };

/**
 * What a column sorts by. Roles: by the highest role (its position), so the orga
 * comes first; joined: the date (unknown last); roster: in a roster first, then
 * with a character, then nothing, each by name.
 */
export function memberSortValue(m: ServerMember, key: MemberSortKey, rolesById: Map<string, MemberRole>): string | number {
    if (key === "roles") {
        const top = m.roleIds.length ? rolesById.get(m.roleIds[0]) : undefined;
        return top ? top.position : -1;
    }
    if (key === "joined") return m.joinedAt || 0;
    if (key === "roster") {
        const rank = m.rosters.length ? 0 : m.characters.length ? 1 : 2;
        return `${rank}${(m.rosters[0] ? m.rosters[0].name : m.characters[0] ? m.characters[0].name : m.name).toLowerCase()}`;
    }
    return m.name.toLowerCase();
}

/** The roles a cell shows (at most `max`, highest first) and how many it leaves out. */
export function splitRoles(roleIds: string[], rolesById: Map<string, MemberRole>, max = 3): { shown: MemberRole[]; more: MemberRole[] } {
    const roles = roleIds.map((id) => rolesById.get(id)).filter((r): r is MemberRole => !!r);
    return { shown: roles.slice(0, max), more: roles.slice(max) };
}

/** "02.06.2026"; "" when Discord does not know it. */
export function joinedDate(ms: number | null): string {
    return ms ? formatWith(ms, { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
}

/** The short name of a version ("TBC", "Forever"); "" for none. */
export function versionShort(versionId: string): string {
    return versionId ? versionLabel([], versionId) : "";
}

/** The WoW class colour of a class id ("Shaman"), "" when unknown. */
export function classColorOf(className: string): string {
    return className && className !== "Any" ? CLASS_COLOR[className] || "" : "";
}

/**
 * What the roster column says about a member: the character that best stands for
 * it (one standing in that roster first) and the roster it is in — or that it has
 * characters but no roster, or nothing at all.
 */
export type RosterView =
    | { kind: "roster"; character: MemberCharacter | null; roster: MemberRoster; more: number }
    | { kind: "outside"; character: MemberCharacter }
    | { kind: "none" };

export function rosterView(m: ServerMember): RosterView {
    if (m.rosters.length) {
        const roster = m.rosters[0];
        const character = m.characters.find((c) => (c.rosterIds || []).includes(roster.id)) || m.characters[0] || null;
        return { kind: "roster", character, roster, more: m.rosters.length - 1 };
    }
    if (m.characters.length) return { kind: "outside", character: m.characters[0] };
    return { kind: "none" };
}

/** The rosters a character stands in, in the member's roster order. */
export function rostersOfCharacter(m: ServerMember, c: MemberCharacter): MemberRoster[] {
    const ids = c.rosterIds || [];
    return m.rosters.filter((r) => ids.includes(r.id));
}

/** The member a link opens (`?user=`), when it is on the list. */
export function memberFromQuery(members: ServerMember[], userId: string | null): ServerMember | null {
    return userId ? members.find((m) => m.id === userId) || null : null;
}
