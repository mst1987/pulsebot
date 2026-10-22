// The takeover assistant's logic (pages/kader/TakeoverWizard.tsx, docs/kaderplaner.md
// "Übernahme"): the draft the four steps fill (role → channels → who → result),
// what keeps a step from going on, the body POST /api/kader/takeover takes, the
// reason a takeover cannot start, and the players still waiting for the role
// ("Rolle nachziehen"). The server checks everything again (rosterTakeover.planOf);
// these checks only say it before the click.
import type { KaderData, KaderState, KaderTakeover, KaderTakeoverBody, KaderTakeoverCheck } from "../../api";
import { normalizeChannelName } from "../discord/channelNames";
import { DEFAULT_EMOJI_SEPARATOR } from "../discord/emoji";

/** The states a takeover hands the role to: everybody from provisional upwards, bench and tentative too. */
export const TAKEOVER_STATES: KaderState[] = ["provisional", "roster", "bench", "tentative"];
export const TAKEOVER_STEPS = ["role", "channels", "who", "result"] as const;
export type TakeoverStep = (typeof TAKEOVER_STEPS)[number];
/** The server's limits (rosterTakeover.js MAX_CHANNELS / NAME_MAX). */
export const MAX_TAKEOVER_CHANNELS = 10;
export const TAKEOVER_NAME_MAX = 100;
/** The longest roster name (rosterStore LIMITS.name). */
export const ROSTER_NAME_MAX = 40;

export type TakeoverChannelDraft = { key: string; name: string; emoji: string; orgaOnlyWrite: boolean };
export type TakeoverDraft = {
    roleName: string;
    /** "#rrggbb", "" = no colour */
    roleColor: string;
    roleEmoji: string;
    categoryMode: "new" | "existing";
    categoryName: string;
    categoryEmoji: string;
    categoryId: string;
    channels: TakeoverChannelDraft[];
    /**
     * The roster the takeover creates when the Kader has none linked
     * (check.createsRoster): its name and the optional raid category ("" = none).
     * null with a linked roster - then nothing of it is sent.
     */
    newRoster: { name: string; categoryId: string } | null;
    /** The switch "Ich habe geprüft …": the start stays locked until it is on. */
    confirmed: boolean;
};

/** A problem of the draft, said in words by `kader.takeover.problem.<code>`. */
export type TakeoverProblem = "role_name" | "role_color" | "role_emoji" | "category" | "category_emoji" | "channel_name" | "channel_emoji" | "too_many_channels" | "roster_name";

let keySeq = 0;
/** A fresh row key for a channel line (React keys only, never sent). */
export function channelKey(): string {
    keySeq += 1;
    return `ch${keySeq}`;
}

/**
 * The draft a new assistant starts with: the role named like the Kader, a new
 * category named like it in lower case, an announcement channel only the orga
 * writes in and a chat. `names` are the two channel names in the page's language.
 * `newRoster`: the roster the takeover creates (check.newRoster) - named like
 * the server proposes, no raid category; null/absent with a linked roster.
 */
export function defaultDraft(kaderName: string, names: { announce: string; chat: string }, newRoster?: { name: string } | null): TakeoverDraft {
    const name = kaderName.trim().slice(0, TAKEOVER_NAME_MAX);
    return {
        roleName: name,
        roleColor: "",
        roleEmoji: "",
        categoryMode: "new",
        categoryName: name.toLowerCase(),
        categoryEmoji: "",
        categoryId: "",
        channels: [
            { key: channelKey(), name: names.announce, emoji: "", orgaOnlyWrite: true },
            { key: channelKey(), name: names.chat, emoji: "", orgaOnlyWrite: false },
        ],
        newRoster: newRoster ? { name: newRoster.name.trim().slice(0, ROSTER_NAME_MAX), categoryId: "" } : null,
        confirmed: false,
    };
}

export function isHexColor(value: string): boolean {
    return /^#[0-9a-f]{6}$/i.test(value);
}

/** What the server takes as an emoji (rosterTakeover.emojiOf): empty, or a short Unicode emoji without text. */
export function emojiOk(value: string): boolean {
    const s = value.trim();
    return !s || (s.length <= 16 && !/[\w<>:#@]/.test(s));
}

/**
 * The draft after a reloaded check: a roster linked meanwhile drops the new
 * roster (the server refuses one with `roster_linked`), a link removed meanwhile
 * brings it in as the server proposes it. Unchanged drafts come back as they are.
 */
export function withCheckRoster(d: TakeoverDraft, check: Pick<KaderTakeoverCheck, "createsRoster" | "newRoster">): TakeoverDraft {
    if (!check.createsRoster) return d.newRoster ? { ...d, newRoster: null } : d;
    if (d.newRoster || !check.newRoster) return d;
    return { ...d, newRoster: { name: check.newRoster.name.trim().slice(0, ROSTER_NAME_MAX), categoryId: "" } };
}

/** The channel's name as Discord will show it: `emoji・name`, lower case, dashes. */
export function channelPreview(c: { name: string; emoji: string }): string {
    const emoji = c.emoji.trim();
    return normalizeChannelName(emoji ? `${emoji}${DEFAULT_EMOJI_SEPARATOR}${c.name.trim()}` : c.name.trim());
}

/** The new category's name as Discord will show it. */
export function categoryPreview(d: TakeoverDraft): string {
    const emoji = d.categoryEmoji.trim();
    return (emoji ? `${emoji}${DEFAULT_EMOJI_SEPARATOR}${d.categoryName.trim()}` : d.categoryName.trim()).slice(0, TAKEOVER_NAME_MAX);
}

/** What keeps one step from going on (the first two steps carry input; "who" and "result" none). */
export function stepProblems(d: TakeoverDraft, step: TakeoverStep): TakeoverProblem[] {
    const out: TakeoverProblem[] = [];
    if (step === "role") {
        if (!d.roleName.trim()) out.push("role_name");
        if (d.roleColor && !isHexColor(d.roleColor)) out.push("role_color");
        if (!emojiOk(d.roleEmoji)) out.push("role_emoji");
        if (d.newRoster && !d.newRoster.name.trim()) out.push("roster_name");
    }
    if (step === "channels") {
        if (d.categoryMode === "existing" ? !d.categoryId : !d.categoryName.trim()) out.push("category");
        if (d.categoryMode === "new" && !emojiOk(d.categoryEmoji)) out.push("category_emoji");
        if (d.channels.length > MAX_TAKEOVER_CHANNELS) out.push("too_many_channels");
        if (d.channels.some((c) => !c.name.trim() || !channelPreview(c))) out.push("channel_name");
        if (d.channels.some((c) => !emojiOk(c.emoji))) out.push("channel_emoji");
    }
    return out;
}

/** Every problem of the draft, step by step. */
export function draftProblems(d: TakeoverDraft): TakeoverProblem[] {
    return [...stepProblems(d, "role"), ...stepProblems(d, "channels")];
}

/**
 * Why the takeover cannot start, the first reason only (null = it can): no
 * roster first (nothing else matters without one), then a closed roster, a
 * hidden version for the roster it would create, nobody to take over, the
 * caller's own rights ("admin_only" when the takeover creates the roster -
 * only full admins may), then what the bot lacks.
 */
export function startBlocker(check: Pick<KaderTakeoverCheck, "blockers" | "canStart" | "createsRoster">): string | null {
    const order = ["already_taken", "no_roster", "roster_closed", "version_hidden", "no_players"];
    for (const code of order) if (check.blockers.includes(code as never)) return code;
    if (!check.canStart) return check.createsRoster ? "admin_only" : "no_rights";
    for (const code of ["offline", "no_manage_roles", "no_manage_channels"]) if (check.blockers.includes(code as never)) return code;
    return null;
}

/** May the start button be pressed: a startable check, no problem in the draft, the switch on. */
export function canStartDraft(d: TakeoverDraft, check: Pick<KaderTakeoverCheck, "blockers" | "canStart" | "createsRoster">): boolean {
    return startBlocker(check) === null && draftProblems(d).length === 0 && d.confirmed;
}

/**
 * The body of POST /api/kader/takeover; the role icon only where the server can
 * show it, the new roster (name, optional category) only when one is created.
 */
export function bodyOf(d: TakeoverDraft, baseRev: number, iconPossible: boolean): KaderTakeoverBody {
    const role: KaderTakeoverBody["role"] = { name: d.roleName.trim() };
    if (d.roleColor) role.color = d.roleColor.toLowerCase();
    if (iconPossible && d.roleEmoji.trim()) role.unicodeEmoji = d.roleEmoji.trim();
    const category: KaderTakeoverBody["category"] = d.categoryMode === "existing"
        ? { id: d.categoryId }
        : { name: d.categoryName.trim(), ...(d.categoryEmoji.trim() ? { emoji: d.categoryEmoji.trim() } : {}) };
    return {
        baseRev,
        role,
        category,
        channels: d.channels.map((c) => ({ name: c.name.trim(), ...(c.emoji.trim() ? { emoji: c.emoji.trim() } : {}), orgaOnlyWrite: c.orgaOnlyWrite })),
        ...(d.newRoster ? { roster: { name: d.newRoster.name.trim(), categoryId: d.newRoster.categoryId || null } } : {}),
    };
}

/** The refusals the assistant says in its own words (`kader.takeover.error.<code>`); anything else shows the server's message. */
export const TAKEOVER_ERRORS = [
    "stale", "already_taken", "no_players", "no_roster", "roster_closed", "offline", "no_manage_roles", "no_manage_channels",
    "invalid_role", "invalid_color", "invalid_emoji", "invalid_category", "too_many_channels", "invalid_channel",
    "role_failed", "role_too_high", "not_manager", "running", "not_taken", "role_gone",
    "admin_only", "version_hidden", "category_taken", "invalid_roster_category", "invalid_name",
    "kader_taken", "roster_linked",
];

/** The i18n key of a refusal, null when the server's message is shown instead. */
export function takeoverErrorKey(code: string): string | null {
    return TAKEOVER_ERRORS.includes(code) ? `kader.takeover.error.${code}` : null;
}

/**
 * The players of a taken-over Kader still waiting for the role (the client
 * twin of kaderRoster.pendingOf): from provisional upwards, the role neither
 * given ("ok") nor taken away in Discord ("removed").
 */
export function pendingOf(kader: Pick<KaderData, "players" | "takeover">): string[] {
    const t = kader.takeover;
    if (!t) return [];
    return Object.entries(kader.players)
        .filter(([uid, e]) => TAKEOVER_STATES.includes(e.state) && t.results[uid] !== "ok" && t.results[uid] !== "removed")
        .map(([uid]) => uid);
}

/** The hand-out so far: how many of the planned players have the role, and what went wrong. */
export function progressOf(kader: Pick<KaderData, "players">, takeover: KaderTakeover): { given: number; total: number; missing: number; failed: number; open: number } {
    const planned = Object.entries(kader.players).filter(([, e]) => TAKEOVER_STATES.includes(e.state)).map(([uid]) => uid);
    let given = 0;
    let missing = 0;
    let failed = 0;
    for (const uid of planned) {
        const r = takeover.results[uid];
        if (r === "ok") given += 1;
        else if (r === "missing") missing += 1;
        else if (r === "failed") failed += 1;
    }
    return { given, total: planned.length, missing, failed, open: planned.length - given - missing - failed };
}
