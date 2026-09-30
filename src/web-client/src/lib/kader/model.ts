// The Kaderplaner's pure helpers (docs/kaderplaner.md): class and spec labels
// and icons, the states of a Kader and who stands in which, the character a
// player is prefilled with. Everything the server already decided (the
// effective character, what deviates from the profile, the prefill source)
// comes with the view model; this only names, counts and sorts.
import type {
    KaderCharacter, KaderClassDef, KaderData, KaderEntry, KaderHistoryItem, KaderPlayer, KaderRole, KaderState, KaderView, KaderWish,
} from "../../api";
import { classLabel, specLabel } from "../wowNames";
import { classIconName } from "../rosterView";
import { formatDayMonth, formatTime } from "../format";
import { t } from "../../i18n";

export const ROLES: KaderRole[] = ["tank", "healer", "melee", "ranged"];
export const STATES: KaderState[] = ["pool", "selected", "provisional", "roster", "bench", "tentative"];
/** The four steps of the pipeline, in the order of the status bar. */
export const STAGES: KaderState[] = ["pool", "selected", "provisional", "roster"];
/** Who may stand in an example setup. */
export const SETUP_STATES: KaderState[] = ["roster", "provisional", "bench", "tentative"];

/** The state changes the server knows (services/kader/kaderPlayers.js MOVES). */
export const MOVES: Record<KaderState, KaderState[]> = {
    pool: ["selected"],
    selected: ["pool", "provisional"],
    provisional: ["selected", "roster", "bench", "tentative"],
    roster: ["provisional", "bench", "tentative"],
    bench: ["provisional", "roster", "tentative"],
    tentative: ["provisional", "roster", "bench"],
};
export const canMove = (from: KaderState, to: KaderState): boolean => from !== to && MOVES[from].includes(to);

export const byId = (players: KaderPlayer[]): Map<string, KaderPlayer> => new Map(players.map((p) => [p.userId, p]));

/** The character the planner uses for a player (the planner's pick, else the profile's main). */
export function activeOf(p: KaderPlayer | undefined | null): KaderCharacter | null {
    if (!p) return null;
    return p.characters.find((c) => c.id === p.activeCharacterId) || null;
}

export function classDef(classes: KaderClassDef[], key: string | undefined | null): KaderClassDef | null {
    return (key && classes.find((c) => c.key === key)) || null;
}

/** The class key of a spec key ("Warrior-Protection" → "Warrior"). */
export const classOfSpec = (spec: string): string => String(spec || "").split("-")[0];

/** "Krieger" / "Warrior" for a class key, the server's label as the fallback. */
export function className(classes: KaderClassDef[], key: string): string {
    const c = classDef(classes, key);
    return classLabel(key, c ? c.name : key);
}

/** "Schutz" / "Protection" for a spec key ("Warrior-Protection"). */
export function specName(classes: KaderClassDef[], key: string | null | undefined): string {
    if (!key) return "";
    const cls = classDef(classes, classOfSpec(key));
    const spec = cls ? cls.specs.find((s) => s.key === key) : null;
    return specLabel(key, spec ? spec.name : key);
}

/** The role of a spec key, null when the rule set does not know it. */
export function specRole(classes: KaderClassDef[], key: string | null | undefined): KaderRole | null {
    if (!key) return null;
    const cls = classDef(classes, classOfSpec(key));
    const spec = cls ? cls.specs.find((s) => s.key === key) : null;
    return spec ? spec.role : null;
}

/** "Krieger · Schutz" for a class/spec pair (a wish, a decision). */
export function wishLabel(classes: KaderClassDef[], w: KaderWish | null | undefined): string {
    if (!w) return "";
    const spec = specName(classes, w.spec);
    return spec ? `${className(classes, w.className)} · ${spec}` : className(classes, w.className);
}

/** The WoW icon of a spec key, as the rule set names it ("" when unknown). */
export function specIconOf(classes: KaderClassDef[], key: string): string {
    const cls = classDef(classes, classOfSpec(key));
    const spec = cls ? cls.specs.find((s) => s.key === key) : null;
    return spec ? spec.icon : "";
}

/** The WoW icon of a class ("classicon_warrior"). */
export function classIconOf(classes: KaderClassDef[], key: string): string {
    const cls = classDef(classes, key);
    return (cls && cls.icon) || (key ? classIconName(key) : "");
}

/** The class colour of a class key, "" when unknown (handed to the stylesheet as --cc, never as color:). */
export function classColor(classes: KaderClassDef[], key: string | null | undefined): string {
    const c = classDef(classes, key);
    return c ? c.color : "";
}

/**
 * What a player plays at a glance, in this order: the decision of a roster
 * player, the first wish of the Kader entry, the prefilled character.
 * `{ className, spec }` or null.
 */
export function mainPick(player: KaderPlayer | undefined, entry?: KaderEntry): KaderWish | null {
    if (entry && entry.state === "roster" && entry.decision) return entry.decision;
    if (entry && entry.wishes.length) return entry.wishes[0];
    if (player && player.prefill && player.prefill.className) return { className: player.prefill.className, spec: player.prefill.spec };
    return null;
}

/** One choice of the spec picker: a wish (rank 1…), the decision outside the wishes (0) or a spec no longer wished (-1). */
export type WishOption = { pick: KaderWish; rank: number };

/**
 * What a player can stand for, as the spec picker lists it: the wishes in wish
 * order, a decision that is none of them first; `current` (a setup slot's spec)
 * is kept even when it is gone from both.
 */
export function wishOptions(entry: KaderEntry, current = ""): WishOption[] {
    const out: WishOption[] = entry.wishes.map((w, i) => ({ pick: w, rank: i + 1 }));
    if (entry.decision && !out.some((o) => o.pick.spec === entry.decision?.spec)) out.unshift({ pick: entry.decision, rank: 0 });
    if (current && !out.some((o) => o.pick.spec === current)) out.unshift({ pick: { className: classOfSpec(current), spec: current }, rank: -1 });
    return out;
}

/** A player's name for the page: the Discord name, else what the Kader kept. */
export function playerName(view: KaderView, userId: string, entry?: KaderEntry): string {
    const p = view.players.find((x) => x.userId === userId);
    return (p && p.displayName !== userId ? p.displayName : "") || (entry && entry.name) || view.names[userId] || userId;
}

/** Any user id as a name (a lead, a voter, who changed a state); "" = the system (a migration). */
export function nameOf(view: KaderView, userId: string): string {
    if (!userId) return t("kader.system");
    return view.names[userId] || userId;
}

/** "30.09." of an ISO time, "" without one. */
export function dayOf(iso: string): string {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? formatDayMonth(ms) : "";
}

/** "02.10. 20:14" of an ISO time, "" without one. */
export function stampOf(iso: string): string {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? `${formatDayMonth(ms)} ${formatTime(ms)}` : "";
}

/** Whole days since an ISO time (0 today), null without one. */
export function daysSince(iso: string, now = Date.now()): number | null {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? Math.max(0, Math.floor((now - ms) / 86400000)) : null;
}

/** How many players stand in each state. */
export function countStates(kader: KaderData): Record<KaderState, number> {
    const out = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<KaderState, number>;
    for (const e of Object.values(kader.players)) out[e.state] += 1;
    return out;
}

/** The entries of a Kader in one or more states, as [userId, entry]. */
export function entriesIn(kader: KaderData, states: KaderState[]): [string, KaderEntry][] {
    return Object.entries(kader.players).filter(([, e]) => states.includes(e.state));
}

/** The best attendance known: the planner's version, else the main version (with its label). */
export function attendanceOf(view: KaderView, player: KaderPlayer | undefined): { pct: number; version: string } | null {
    if (!player) return null;
    if (player.attendance) return { pct: player.attendance.pct, version: "" };
    if (player.attendanceMain) return { pct: player.attendanceMain.pct, version: view.mainVersion.label };
    return null;
}

/** "83 %" or "—" while nothing is counted. */
export function attText(att: { pct: number } | null): string {
    return att ? `${att.pct} %` : "—";
}

/** Name, Discord name, characters, the prefilled character and the wishes — what a search looks through. */
export function searchText(view: KaderView, userId: string, entry?: KaderEntry): string {
    const p = view.players.find((x) => x.userId === userId);
    const parts = [playerName(view, userId, entry)];
    if (p) {
        for (const c of p.characters) parts.push(c.name, className(view.classes, c.className), specName(view.classes, c.mainSpec));
        if (p.prefill) parts.push(p.prefill.name, className(view.classes, p.prefill.className), specName(view.classes, p.prefill.spec));
    }
    for (const w of entry ? entry.wishes : []) parts.push(className(view.classes, w.className), specName(view.classes, w.spec));
    return parts.join(" ").toLowerCase();
}

/** The role counts of a list of picks: `{ tank, healer, melee, ranged }`, unknown specs left out. */
export function roleCounts(classes: KaderClassDef[], picks: (KaderWish | null)[]): Record<KaderRole, number> {
    const out: Record<KaderRole, number> = { tank: 0, healer: 0, melee: 0, ranged: 0 };
    for (const p of picks) {
        const role = p ? specRole(classes, p.spec) : null;
        if (role) out[role] += 1;
    }
    return out;
}

/** One line of a player's history in a Kader, in the menu language. */
export function historyText(view: KaderView, item: KaderHistoryItem): string {
    const state = (s?: string) => (s ? t(`kader.state.${s}`) : "");
    switch (item.type) {
        case "added": return t("kader.history.added");
        case "state": return t("kader.history.state", { from: state(item.from), to: state(item.to) });
        case "decision": return t("kader.history.decision", { pick: wishLabel(view.classes, { className: item.className || "", spec: item.spec || "" }) });
        case "interview_completed": return t("kader.history.completed");
        case "interview_reopened": return t("kader.history.reopened");
        case "vote": return item.vote && item.vote !== "none" ? t("kader.history.vote", { vote: t(`kader.vote.${item.vote}`) }) : t("kader.history.voteNone");
        case "migrated": return t("kader.history.migrated", { to: state(item.to) });
        default: return item.type;
    }
}
