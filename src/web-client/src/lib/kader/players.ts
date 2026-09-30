// "Spieler finden" of the Kaderplaner (docs/kaderplaner.md): the filters with
// their counts, the sort and the grouping of the player list. Pure; the texts
// come from the i18n layer at call time.
import type { KaderClassDef, KaderDay, KaderGear, KaderPlayer, KaderRole } from "../../api";
import { t } from "../../i18n";
import { rolePluralLabel } from "../wowNames";
import { ROLES, activeOf, className, pctOf, searchText, type Status } from "./model";

export type Filters = {
    q: string;
    status: Status[];
    roles: KaderRole[];
    classes: string[];
    minAtt: number;
    days: KaderDay[];
    gear: KaderGear[];
};
export const EMPTY_FILTERS: Filters = { q: "", status: [], roles: [], classes: [], minAtt: 0, days: [], gear: [] };

export type GroupBy = "role" | "cls" | "att" | "status" | "none";
export type SortBy = "att" | "name";

export const GROUP_BYS: GroupBy[] = ["role", "cls", "att", "status", "none"];
export const STATUSES: Status[] = ["kader", "bench", "none"];
export const DAYS: KaderDay[] = ["mo", "di", "mi", "do", "fr", "sa", "so"];
export const GEARS: KaderGear[] = ["ready", "usable", "none"];
export const ATT_STEPS = [0, 50, 75, 90];
/** The attendance tiers of the grouping: from this percentage up. */
export const TIERS = [90, 75, 50, 0];

/** Stands for "no class" in the class filter. */
export const NO_CLASS = "-";

type Skip = keyof Omit<Filters, "q"> | null;

/** Whether a player passes every filter except the one named in `skip` (for the counts in the menus). */
export function passes(p: KaderPlayer, f: Filters, status: (id: string) => Status, classes: KaderClassDef[], skip: Skip = null): boolean {
    const q = f.q.trim().toLowerCase();
    const a = activeOf(p);
    if (q && !searchText(p, classes).includes(q)) return false;
    if (skip !== "status" && f.status.length && !f.status.includes(status(p.userId))) return false;
    if (skip !== "roles" && f.roles.length && !(a && a.role && f.roles.includes(a.role))) return false;
    if (skip !== "classes" && f.classes.length && !f.classes.includes(a ? a.className : NO_CLASS)) return false;
    if (skip !== "minAtt" && f.minAtt > 0 && (pctOf(p) ?? 0) < f.minAtt) return false;
    if (skip !== "days" && f.days.length && !f.days.every((d) => p.availability.includes(d))) return false;
    if (skip !== "gear" && f.gear.length && !f.gear.includes(a ? a.gear : "none")) return false;
    return true;
}

/** How many players pass the other filters and `test`: the count beside a menu option. */
export function countWith(players: KaderPlayer[], f: Filters, status: (id: string) => Status, classes: KaderClassDef[], skip: Skip, test: (p: KaderPlayer) => boolean): number {
    return players.filter((p) => test(p) && passes(p, f, status, classes, skip)).length;
}

export function filterCount(f: Filters): number {
    return f.status.length + f.roles.length + f.classes.length + (f.minAtt > 0 ? 1 : 0) + f.days.length + f.gear.length;
}

/** The stored filters, repaired: an old or foreign value in localStorage never breaks the page. */
export function cleanFilters(raw: unknown): Filters {
    const f = (raw && typeof raw === "object" ? raw : {}) as Partial<Filters>;
    const list = <T>(v: unknown, allowed: readonly T[]): T[] => (Array.isArray(v) ? v.filter((x) => allowed.includes(x as T)) as T[] : []);
    return {
        q: typeof f.q === "string" ? f.q : "",
        status: list(f.status, STATUSES),
        roles: list(f.roles, ROLES),
        classes: Array.isArray(f.classes) ? f.classes.filter((x): x is string => typeof x === "string") : [],
        minAtt: ATT_STEPS.includes(Number(f.minAtt)) ? Number(f.minAtt) : 0,
        days: list(f.days, DAYS),
        gear: list(f.gear, GEARS),
    };
}

const displayName = (p: KaderPlayer) => activeOf(p)?.name || p.displayName;

export function sortPlayers(list: KaderPlayer[], by: SortBy): KaderPlayer[] {
    const att = (p: KaderPlayer) => pctOf(p) ?? -1;
    return [...list].sort(by === "name"
        ? (a, b) => displayName(a).localeCompare(displayName(b))
        : (a, b) => att(b) - att(a) || displayName(a).localeCompare(displayName(b)));
}

export function tierOf(pct: number): number {
    return TIERS.findIndex((min) => pct >= min);
}

export type PlayerGroup = {
    key: string;
    title: string;
    /** A class colour for the title (class grouping), else "". */
    color: string;
    /** A tone class for the title: "tier-0"…"tier-3", "st-kader", "muted". */
    tone: string;
    items: KaderPlayer[];
    /** Average attendance of those with any, null when nobody has one. */
    avg: number | null;
    mix: { key: string; color: string; share: number; n: number }[];
    inKader: number;
};

type GroupDef = { key: string; title: string; color?: string; tone?: string; test: (p: KaderPlayer) => boolean };

function groupDefs(by: GroupBy, classes: KaderClassDef[], status: (id: string) => Status): GroupDef[] {
    if (by === "role") {
        return [
            ...ROLES.map((r) => ({ key: r, title: rolePluralLabel(r), test: (p: KaderPlayer) => activeOf(p)?.role === r })),
            { key: NO_CLASS, title: t("kader.group.noRole"), tone: "muted", test: (p: KaderPlayer) => !activeOf(p)?.role },
        ];
    }
    if (by === "cls") {
        return [
            ...classes.map((c) => ({ key: c.key, title: className(classes, c.key), color: c.color, test: (p: KaderPlayer) => activeOf(p)?.className === c.key })),
            { key: NO_CLASS, title: t("kader.group.noClass"), tone: "muted", test: (p: KaderPlayer) => !activeOf(p) },
        ];
    }
    if (by === "att") {
        return [
            ...TIERS.map((_min, i) => ({
                key: `tier-${i}`,
                title: t(`kader.tier.t${i}`),
                tone: `tier-${i}`,
                test: (p: KaderPlayer) => pctOf(p) !== null && tierOf(pctOf(p) as number) === i,
            })),
            { key: "tier-none", title: t("kader.group.noData"), tone: "muted", test: (p: KaderPlayer) => pctOf(p) === null },
        ];
    }
    if (by === "status") {
        return STATUSES.map((s) => ({ key: s, title: t(`kader.status.${s}`), tone: `st-${s}`, test: (p: KaderPlayer) => status(p.userId) === s }));
    }
    return [{ key: "all", title: t("kader.group.all"), test: () => true }];
}

/** The list's groups (empty ones left out) with count, class mix, how many are in the roster and the average attendance. */
export function groupPlayers(list: KaderPlayer[], by: GroupBy, classes: KaderClassDef[], status: (id: string) => Status): PlayerGroup[] {
    return groupDefs(by, classes, status)
        .map((d) => {
            const items = list.filter(d.test);
            const rates = items.map(pctOf).filter((x): x is number => x !== null);
            const mix = classes
                .map((c) => ({ key: c.key, color: c.color, n: items.filter((p) => activeOf(p)?.className === c.key).length }))
                .filter((m) => m.n > 0)
                .map((m) => ({ ...m, share: (m.n / items.length) * 100 }));
            return {
                key: d.key,
                title: d.title,
                color: d.color || "",
                tone: d.tone || "",
                items,
                avg: rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null,
                mix,
                inKader: items.filter((p) => status(p.userId) === "kader").length,
            };
        })
        .filter((g) => g.items.length > 0);
}
