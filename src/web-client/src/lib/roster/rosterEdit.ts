// The pure rules of editing a roster (#655-#657): what a refusal code says in
// words, which role writes failed and why, how the characters of a member are
// reordered and assigned, how a history line reads, the state of a buff, the
// slot steppers. Texts go through t() at call time (namespace roster).
import type { ApiError, RosterComposition, RosterHistoryEntry, RosterMember, RosterMemberChar, RosterRoleResult, RosterSearchChar, RosterStatus, RosterSync } from "../../api";
import { hasKey, t } from "../../i18n";
import { formatDate, isoDay } from "../format";
import { classLabel, specLabel } from "../wow/wowNames";
import { wowIconUrl } from "../wow/wowIcon";
import { classIconName } from "./rosterView";

/** A refused request in the menu language: the code's own text, else a general sentence with the code. */
export function errorText(err: Partial<ApiError> | null | undefined): string {
    const code = String((err && err.code) || "");
    if (code && hasKey(`roster.err.${code}`)) return t(`roster.err.${code}`);
    if (code && hasKey(`roster.roleCode.${code}`)) return t(`roster.roleCode.${code}`);
    return t("roster.err.unknown", { code: code || "?" });
}

/** Why a role write did not happen, in words (memberRoles codes: no_permission, role_too_high, offline, …). */
export function roleCodeText(code: string): string {
    return hasKey(`roster.roleCode.${code}`) ? t(`roster.roleCode.${code}`) : t("roster.roleCode.failed");
}

/** "@Raider" — a role's name as the page writes it; the id when Discord does not list it. */
export function roleName(result: Pick<RosterRoleResult, "roleName" | "roleId">): string {
    return result.roleName ? `@${result.roleName}` : result.roleId;
}

/** The failed role writes of an answer, one sentence each; empty when every write went through. */
export function failedRoleLines(results: RosterRoleResult[] | undefined): string[] {
    return (results || [])
        .filter((r) => !r.ok)
        .map((r) => t(r.give ? "roster.roles.giveFailed" : "roster.roles.takeFailed", { role: roleName(r), reason: roleCodeText(r.code) }));
}

/** The role writes that changed something, one short sentence each ("@Raider gegeben"). */
export function changedRoleLines(results: RosterRoleResult[] | undefined): string[] {
    return (results || []).filter((r) => r.ok && r.changed).map((r) => t(r.give ? "roster.roles.given" : "roster.roles.taken", { role: roleName(r) }));
}

/** The keys with the one at `index` moved one place up (-1) or down (+1); unchanged at an edge. */
export function moveChar(keys: string[], index: number, dir: -1 | 1): string[] {
    const to = index + dir;
    if (index < 0 || index >= keys.length || to < 0 || to >= keys.length) return keys;
    const next = [...keys];
    [next[index], next[to]] = [next[to], next[index]];
    return next;
}

/** The keys after assigning `key`: appended with several characters allowed, else it replaces the one there is. */
export function assignChar(keys: string[], key: string, multi: boolean): string[] {
    if (!key) return keys;
    if (!multi) return [key];
    return keys.includes(key) ? keys : [...keys, key];
}

/** "forever~aldric sturmwind" -> "Aldric Sturmwind": a stored key read back as a name. */
export function nameOfKey(key: string): string {
    const bare = String(key || "").split("~").pop() || "";
    return bare.split(" ").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const STATUSES: RosterStatus[] = ["core", "trial", "bench", "pause"];
const statusWord = (s: string) => (STATUSES.includes(s as RosterStatus) ? t(`roster.status.${s}`) : s);

/** A list of character keys as names ("Devi, Grimbrew"); "" for none or "-". */
function charList(raw: string): string {
    const keys = raw.split(",").map((s) => s.trim()).filter((s) => s && s !== "-");
    return keys.map(nameOfKey).join(", ");
}

/** "via Discord · core, devi" -> { via: true, rest: "core, devi" }. */
function splitVia(detail: string): { via: boolean; rest: string } {
    const d = String(detail || "");
    if (!d.startsWith("via Discord")) return { via: false, rest: d };
    return { via: true, rest: d.replace(/^via Discord( · )?/, "") };
}

/** One part of a "member" line: "status core → bench", "chars a, b", "note", "trialUntil <iso>|-". */
function memberPart(part: string): string {
    const p = part.trim();
    const status = p.match(/^status (\w+) → (\w+)$/);
    if (status) return t("roster.hist.part.status", { from: statusWord(status[1]), to: statusWord(status[2]) });
    if (p.startsWith("chars ")) {
        const list = charList(p.slice(6));
        return list ? t("roster.hist.part.chars", { chars: list }) : t("roster.hist.part.charsNone");
    }
    if (p === "note") return t("roster.hist.part.note");
    if (p.startsWith("trialUntil ")) {
        const at = Date.parse(p.slice(11));
        return Number.isFinite(at) ? t("roster.hist.part.trialUntil", { date: formatDate(at) }) : t("roster.hist.part.trialNone");
    }
    return p;
}

/** The settings fields of a "settings" line in words ("Name, Plätze"). */
function settingsFields(detail: string): string {
    return detail.split(",").map((s) => s.trim()).filter(Boolean)
        .map((f) => (hasKey(`roster.hist.field.${f}`) ? t(`roster.hist.field.${f}`) : f)).join(", ");
}

/** "@Raider: no_permission" -> { role: "@Raider", reason: "…" }. */
function roleDetail(detail: string): { role: string; reason: string } {
    const i = detail.lastIndexOf(": ");
    if (i < 0) return { role: detail, reason: "" };
    return { role: detail.slice(0, i), reason: roleCodeText(detail.slice(i + 2)) };
}

/**
 * One history line in words, without who did it and when (the list shows those
 * beside it). `withUser` false leaves out the person it is about (the member
 * drawer only lists that one person's lines).
 */
export function historyText(entry: RosterHistoryEntry, withUser = true): string {
    const user = withUser ? entry.userName || entry.userId : "";
    const { via, rest } = splitVia(entry.detail);
    const viaText = via ? ` ${t("roster.hist.viaDiscord")}` : "";
    const u = (key: string, params: Record<string, string> = {}) => t(`${key}${user ? "" : "Self"}`, { user, ...params });
    switch (entry.what) {
        case "created":
            return entry.detail === "migration" ? t("roster.hist.createdMigration") : t("roster.hist.created");
        case "settings":
            return t("roster.hist.settings", { fields: settingsFields(entry.detail) });
        case "member-added": {
            const [status = "", ...chars] = rest.split(",").map((s) => s.trim());
            const list = charList(chars.join(","));
            const base = u("roster.hist.added", { status: statusWord(status) });
            return `${base}${list ? ` ${t("roster.hist.withChars", { chars: list })}` : ""}${viaText}`;
        }
        case "member": {
            const parts = rest.split(";").map(memberPart).filter(Boolean).join(", ") || t("roster.hist.changed");
            return `${user ? `${user}: ${parts}` : parts.charAt(0).toUpperCase() + parts.slice(1)}${viaText}`;
        }
        case "member-removed":
            return `${u("roster.hist.removed")}${viaText}`;
        case "role-given":
        case "role-taken":
        case "role-give-failed":
        case "role-take-failed": {
            const { role, reason } = roleDetail(entry.detail);
            const key = { "role-given": "roleGiven", "role-taken": "roleTaken", "role-give-failed": "roleGiveFailed", "role-take-failed": "roleTakeFailed" }[entry.what];
            return u(`roster.hist.${key}`, { role, reason });
        }
        default:
            return [entry.what, entry.detail].filter(Boolean).join(" · ");
    }
}

/** Covered by two or more members, by exactly one ("knapp": one absence and it is gone), or by nobody. */
export function buffState(buff: RosterComposition["buffs"][number]): "covered" | "thin" | "missing" {
    if (!buff.providers.length) return "missing";
    return buff.providers.length === 1 ? "thin" : "covered";
}

/** How many people the Abgleich tab asks to act on (the three person lists; log characters are a hint). */
export function syncOpenCount(sync: Pick<RosterSync, "inRosterWithoutRole" | "roleWithoutRoster" | "withoutChar"> | null | undefined): number {
    if (!sync) return 0;
    return sync.inRosterWithoutRole.length + sync.roleWithoutRoster.length + sync.withoutChar.length;
}

/** A stepper's next value, kept inside [min, max]. */
export function stepValue(value: number, delta: number, min = 0, max = 200): number {
    return Math.max(min, Math.min(max, Math.round((Number(value) || 0) + delta)));
}

/** The squares of a role card: `actual` filled up to the target, the rest empty, anything past the target filled too. */
export function slotSquares(target: number, actual: number, cap = 40): ("on" | "off")[] {
    const n = Math.min(cap, Math.max(target, actual));
    return Array.from({ length: n }, (_, i) => (i < actual ? "on" : "off"));
}

/** "2026-10-23" for a date input from a stored ISO time; "" without one. */
export function dateInputValue(iso: string | null | undefined): string {
    if (!iso) return "";
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? isoDay(ms) : "";
}

/** A character as both the roster and the member search describe it. */
export type AnyChar = Pick<RosterMemberChar, "name" | "className" | "classColor" | "specId" | "specLabel" | "specIcon"> & { iconUrl?: string };

/** The icon of a character: its spec, else the cache's icon, else its class. */
export function charIcon(char: AnyChar): string {
    if (char.specIcon) return wowIconUrl(char.specIcon, 36);
    if (char.iconUrl) return char.iconUrl;
    return char.className ? wowIconUrl(classIconName(char.className), 36) : "";
}

/** "Krieger · Schutz" — the class, and the spec when known. */
export function charLine(char: AnyChar): string {
    const cls = classLabel(char.className, char.className);
    const spec = char.specId ? specLabel(char.specId, char.specLabel) : "";
    return [cls, spec].filter(Boolean).join(" · ");
}

/** A search result's character in the shape the chips read. */
export function searchChar(c: RosterSearchChar): AnyChar {
    return { name: c.name, className: c.className, classColor: c.classColor, specId: c.specId, specLabel: c.specLabel, specIcon: c.specIcon };
}

/** "Stamm seit 02.06.2026" — the status of a member and since when, as the member drawer's head says it. */
export function statusSince(member: Pick<RosterMember, "status" | "since">): string {
    const status = t(`roster.status.${member.status}`);
    return member.since ? t("roster.drawer.statusSince", { status, date: formatDate(Date.parse(member.since)) }) : status;
}