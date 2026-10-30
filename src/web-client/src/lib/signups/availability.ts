// Ab- & Anwesenheit: the small pure rules of the signup page's section and its
// dialog — how a period reads, which spec an attendance suggests, and the
// one-line summary of what a save did (src/services/signups/availability.js
// decides everything else on the server).
import type {
    AvailabilityCharacter, AvailabilityEntry, AvailabilityKind, AvailabilityRaid, AvailabilityResult, AvailabilityScopePart,
    AvailabilityServer,
} from "../../api";
import { formatDayDate } from "../format";
import { specLabel } from "../wow/wowNames";
import { t } from "../../i18n";

/** A category's name without its leading emoji (lib/roster/absences imports from here, so not from there). */
function plainCategoryName(name: string): string {
    const raw = String(name || "").trim();
    return raw.replace(/^[^\p{L}\p{N}]+/u, "").trim() || raw;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Noon (UTC) of a "yyyy-MM-dd" day — the same calendar day in the guild's time zone; 0 for anything else. */
export function dayMs(day: string): number {
    const m = DAY.exec(day || "");
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : 0;
}

/** "Mo 05.10. – Fr 09.10." / one day once. */
export function periodLabel(from: string, to: string): string {
    const a = formatDayDate(dayMs(from));
    if (!to || to === from) return a;
    return `${a} – ${formatDayDate(dayMs(to))}`;
}

/** The "Bis" after "Von" moved: kept when still after it, else the new "Von". */
export function nextTo(from: string, to: string): string {
    return !to || to < from ? from : to;
}

/** The spec an attendance starts with: the first one raid-ready, else the first. */
export function firstSpec(character: AvailabilityCharacter | undefined): string {
    if (!character || !character.specs.length) return "";
    return (character.specs.find((s) => s.gear === "ready") || character.specs[0]).key;
}

/**
 * Whether the server would leave this raid alone anyway (availability.js): an
 * attendance never touches an existing signup or absence, an absence never one
 * already signed off. The dialog shows such a raid greyed out and unpicked.
 */
export function staysAsIs(kind: AvailabilityKind, status: string): boolean {
    return kind === "presence" ? !!status : status === "absence";
}

/**
 * Whether the dialog leaves a raid alone: what staysAsIs says, and when editing a raid the entry already
 * changed (`applied` — it stays) or, for an attendance, one another absence covers (`absent`).
 */
export function raidFixed(kind: AvailabilityKind, raid: Pick<AvailabilityRaid, "status" | "applied" | "absent">): boolean {
    return staysAsIs(kind, raid.status) || !!raid.applied || (kind === "presence" && !!raid.absent);
}

// ---- where an entry holds: servers and their categories ----

/** The dialog's pick per server: "all" its categories, or only these; a server not in it is not picked. */
export type ScopePick = Record<string, "all" | string[]>;

/** The server a category belongs to, "" when none of the given has it. */
function serverOfCategory(servers: AvailabilityServer[], categoryId: string): string {
    const hit = servers.find((s) => s.categories.some((c) => c.id === categoryId));
    return hit ? hit.guildId : "";
}

/**
 * The pick a new entry starts with: that one category when the page opened on one (`categoryId`), else
 * the server the web shows (`activeGuildId`, else the first) with every category; nothing without a server.
 */
export function initialScope(servers: AvailabilityServer[], { categoryId = "", activeGuildId = "" } = {}): ScopePick {
    const of = categoryId ? serverOfCategory(servers, categoryId) : "";
    if (of) return { [of]: [categoryId] };
    const server = servers.find((s) => s.guildId === activeGuildId) || servers[0];
    return server ? { [server.guildId]: "all" } : {};
}

/**
 * The pick of an entry being edited: its scope, an older entry's lone category placed on its server,
 * an older entry for everything (no scope) every server with all categories.
 */
export function scopeFromEntry(entry: Pick<AvailabilityEntry, "scope" | "categoryId">, servers: AvailabilityServer[]): ScopePick {
    const parts = entry.scope && entry.scope.length ? entry.scope
        : entry.categoryId ? [{ guildId: "", name: "", categories: [{ id: entry.categoryId, name: "" }] }] : [];
    if (!parts.length) return Object.fromEntries(servers.map((s) => [s.guildId, "all" as const]));
    const pick: ScopePick = {};
    for (const part of parts) {
        const ids = part.categories.map((c) => c.id);
        if (part.guildId) {
            const had = pick[part.guildId];
            pick[part.guildId] = !ids.length || had === "all" ? "all" : [...(had || []), ...ids.filter((id) => !(had || []).includes(id))];
            continue;
        }
        // an older part: each category on the server that has it now
        for (const id of ids) {
            const guildId = serverOfCategory(servers, id);
            if (!guildId) continue;
            const had = pick[guildId];
            if (had === "all") continue;
            pick[guildId] = had ? (had.includes(id) ? had : [...had, id]) : [id];
        }
    }
    return pick;
}

/** "Alle Kategorien" of a server clicked: on, or off again. */
export function toggleServer(pick: ScopePick, guildId: string): ScopePick {
    const next = { ...pick };
    if (next[guildId] === "all") delete next[guildId];
    else next[guildId] = "all";
    return next;
}

/** One category clicked: added or removed; out of "all" it is that one alone; the last one removed drops the server. */
export function toggleCategory(pick: ScopePick, guildId: string, categoryId: string): ScopePick {
    const next = { ...pick };
    const had = next[guildId];
    const list = had === "all" || !had ? [] : had;
    const changed = had === "all" ? [categoryId] : list.includes(categoryId) ? list.filter((id) => id !== categoryId) : [...list, categoryId];
    if (changed.length) next[guildId] = changed;
    else delete next[guildId];
    return next;
}

/** The body's `scope`, in the order of the servers: one part per picked server, no categories = all. */
export function scopeParts(pick: ScopePick, servers: AvailabilityServer[]): AvailabilityScopePart[] {
    return servers
        .filter((s) => pick[s.guildId])
        .map((s) => {
            const p = pick[s.guildId];
            return { guildId: s.guildId, categoryIds: p === "all" ? [] : s.categories.filter((c) => p.includes(c.id)).map((c) => c.id) };
        })
        .filter((p) => pick[p.guildId] === "all" || p.categoryIds.length);
}

/**
 * The game versions the picked categories play — an attendance offers only characters of them; null =
 * any (a picked server or category without a known version).
 */
export function pickedVersions(pick: ScopePick, servers: AvailabilityServer[]): string[] | null {
    const out: string[] = [];
    for (const s of servers) {
        const p = pick[s.guildId];
        if (!p) continue;
        const cats = p === "all" ? s.categories : s.categories.filter((c) => p.includes(c.id));
        if (!cats.length || cats.some((c) => !c.versionId)) return null;
        for (const c of cats) if (!out.includes(c.versionId)) out.push(c.versionId);
    }
    return out;
}

/** The characters an attendance can use, one group per game version, in the raider's own order. */
export function characterGroups(characters: AvailabilityCharacter[], versions: string[] | null): { versionId: string; characters: AvailabilityCharacter[] }[] {
    const groups: { versionId: string; characters: AvailabilityCharacter[] }[] = [];
    for (const c of characters) {
        if (versions && !versions.includes(c.versionId)) continue;
        const group = groups.find((g) => g.versionId === c.versionId);
        if (group) group.characters.push(c);
        else groups.push({ versionId: c.versionId, characters: [c] });
    }
    return groups;
}

/** The picked characters: key -> spec. In the dialog's own choices "" means "left out on purpose". */
export type CharPick = Record<string, string>;

type CharGroup = { characters: AvailabilityCharacter[] };

/**
 * The characters an attendance uses: per version what the raider chose there, and where they chose
 * nothing yet the first character (their own order, there is no main) — so a version added later by the
 * scope comes with its first character, while one the raider emptied stays empty.
 */
export function effectiveChars(chosen: CharPick, groups: CharGroup[]): CharPick {
    const out: CharPick = {};
    for (const g of groups) {
        const touched = g.characters.some((c) => c.key in chosen);
        if (!touched) {
            const first = g.characters[0];
            if (first) out[first.key] = firstSpec(first);
            continue;
        }
        for (const c of g.characters) {
            const spec = chosen[c.key];
            if (spec) out[c.key] = c.specs.some((s) => s.key === spec) ? spec : firstSpec(c);
        }
    }
    return out;
}

/** The choices with this character's whole version written out, so changing one row keeps the others as shown. */
function ownGroup(chosen: CharPick, groups: CharGroup[], key: string): CharPick {
    const group = groups.find((g) => g.characters.some((c) => c.key === key));
    if (!group) return { ...chosen };
    const shown = effectiveChars(chosen, [group]);
    const next = { ...chosen };
    for (const c of group.characters) next[c.key] = shown[c.key] || "";
    return next;
}

/** One character row clicked: in (with its first spec) or out. */
export function toggleChar(chosen: CharPick, groups: CharGroup[], character: AvailabilityCharacter): CharPick {
    const next = ownGroup(chosen, groups, character.key);
    next[character.key] = next[character.key] ? "" : firstSpec(character);
    return next;
}

/** Another spec for a character — it is then picked, too. */
export function setCharSpec(chosen: CharPick, groups: CharGroup[], key: string, spec: string): CharPick {
    return { ...ownGroup(chosen, groups, key), [key]: spec };
}

/**
 * The characters of an entry being edited: matched by key, else by name (the server stores the name).
 * Feeds effectiveChars as the raider's choice: the other characters of those versions stay out.
 */
export function charsFromEntry(entry: Pick<AvailabilityEntry, "characters" | "character" | "spec">, characters: AvailabilityCharacter[]): CharPick {
    const list = entry.characters && entry.characters.length ? entry.characters
        : entry.character ? [{ character: entry.character, spec: entry.spec }] : [];
    const pick: CharPick = {};
    for (const one of list) {
        const name = one.character.trim().toLowerCase();
        const c = characters.find((x) => x.key === one.character) || characters.find((x) => x.name.trim().toLowerCase() === name);
        if (!c) continue;
        pick[c.key] = c.specs.some((s) => s.key === one.spec) ? one.spec : firstSpec(c);
    }
    return pick;
}

/** The body's `characters` in the raider's order, only those still offered. */
export function charactersInput(pick: CharPick, offered: AvailabilityCharacter[]): { character: string; spec: string }[] {
    return offered.filter((c) => pick[c.key]).map((c) => ({ character: c.key, spec: pick[c.key] }));
}

/** Category id -> name from the servers the dialog offers (the fallback when an entry's scope lacks a name). */
export function categoryNames(servers: { categories: { id: string; name: string }[] }[] = []): Record<string, string> {
    const out: Record<string, string> = {};
    for (const s of servers) for (const c of s.categories) if (c.name) out[c.id] = c.name;
    return out;
}

/**
 * Where an entry holds, in words: "Pulse · Alle Kategorien", "Pulse · Karazhan, Gruul"; servers apart by " / ".
 * `names` (categoryNames) fills a category the server sent without its name — never a bare id when it is known.
 */
export function scopeLabel(entry: Pick<AvailabilityEntry, "scope" | "categoryName">, names: Record<string, string> = {}): string {
    const parts = entry.scope || [];
    if (!parts.length) return entry.categoryName ? plainCategoryName(entry.categoryName) : t("signups.availability.everywhere");
    return parts.map((p) => {
        const cats = p.categories.length
            ? p.categories.map((c) => plainCategoryName(c.name || names[c.id] || c.id)).join(", ")
            : t("signups.availability.dialog.allOfServer");
        return [p.name, cats].filter(Boolean).join(" · ");
    }).join(" / ");
}

/** An attendance's characters, each "Name · Spec" (an older entry has just the one). */
export function entryCharacters(entry: {
    characters?: { character: string; spec: string; specLabel?: string }[]; character: string; spec: string; specLabel?: string;
}): string[] {
    const list = entry.characters && entry.characters.length
        ? entry.characters
        : entry.character ? [{ character: entry.character, spec: entry.spec, specLabel: entry.specLabel }] : [];
    return list.map((c) => [c.character, c.spec ? specLabel(c.spec, c.specLabel) : ""].filter(Boolean).join(" · "));
}

/** What a save did, counted: changed, skipped (already so), failed. */
export function countResults(results: AvailabilityResult[]): { done: number; skipped: number; failed: number } {
    return {
        done: results.filter((r) => r.ok).length,
        skipped: results.filter((r) => !r.ok && r.skipped).length,
        failed: results.filter((r) => !r.ok && !r.skipped).length,
    };
}

/** "3 Raids abgemeldet · 1 übersprungen" — the toast after saving. */
export function resultSummary(kind: AvailabilityKind, results: AvailabilityResult[], dm: boolean): string {
    const { done, skipped, failed } = countResults(results);
    const parts = [
        results.length
            ? t(kind === "absence" ? "signups.availability.result.signedOff" : "signups.availability.result.signedUp", { count: done })
            : t("signups.availability.result.noRaid"),
        skipped ? t("signups.availability.result.skipped", { count: skipped }) : "",
        failed ? t("signups.availability.result.failed", { count: failed }) : "",
        dm ? "" : t("signups.availability.result.noDm"),
    ];
    return parts.filter(Boolean).join(" · ");
}

/** Why one raid was left alone, in words. */
export function skipReason(result: AvailabilityResult): string {
    if (result.ok) return "";
    if (result.skipped) return t(`signups.availability.skip.${result.skipped}`);
    return result.error;
}
