import type { BotChannel, BotFunction, BotMessage, DiscordOverview, SessionUser } from "../../api";
import { MENU, matchesHref, mayOpen } from "../app/menu";
import { t, tOr } from "../../i18n";
import { permissionLabel } from "./permissions";

// System › Discord › Übersicht (pages/channels/DiscordOverviewPage.tsx): what of
// one server side needs the orga's attention, derived from /api/discord/overview.
// Kept out of the page so it stays a pure component module and can be tested
// without a DOM. Every point carries a status word (fehlt, gelöscht, Hinweis,
// Aufräumen), what it is about, why, and where to fix it — a link the account
// may open, or none.

export type AttentionTone = "bad" | "mid" | "calm";

export type AttentionItem = {
    id: string;
    tone: AttentionTone;
    /** the status word: fehlt, gelöscht, Hinweis, kein Zugriff, Aufräumen */
    status: string;
    /** what it is about: a bot function, a channel, a role, a message */
    what: string;
    /** why it shows here, one short line */
    why: string;
    /** where to fix it; `to` "#bot-check" is the section on the page, null = no page the account may open */
    action: { label: string; to: string } | null;
};

/** Where a fixed message of each kind is posted again from. */
const MESSAGE_HOME: Record<string, string> = {
    roleMessage: "/channels/roles",
    addonCenter: "/addon",
    recruitment: "/recruitment",
    orgaHub: "/settings?section=kategorien",
    availability: "/settings?section=kategorien",
    raidOverview: "/settings?section=discordserver",
    talkOverview: "/settings?section=discordserver",
};

const TONE_ORDER: Record<AttentionTone, number> = { bad: 0, mid: 1, calm: 2 };

/** Whether the account may open a page of the admin (the menu entry it lies under decides). */
export function mayOpenHref(user: SessionUser | null, href: string): boolean {
    if (href.startsWith("#")) return true;
    const path = href.split("?")[0];
    const entry = [...MENU].sort((a, b) => b.href.length - a.href.length).find((e) => matchesHref(e.href, path));
    return entry ? mayOpen(user, entry) : false;
}

/** A right's label in the active language: the client knows the permissions, the intents keep the server's label. */
export function rightLabel(right: { key: string; label: string }): string {
    return tOr(`discord.overview.right.${right.key}`, "") || (permissionLabel(right.key) !== right.key ? permissionLabel(right.key) : right.label);
}

/** A bot function's label in the active language (the server sends the German one). */
export const functionLabel = (f: { key: string; label: string }) => tOr(`discord.overview.fn.${f.key}`, f.label);

/** A channel purpose's label in the active language; a category's own channel keeps its "(Kategorie)" mark. */
export function purposeLabel(c: { key: string; label: string }): string {
    const label = tOr(`discord.overview.purpose.${c.key}`, c.label);
    return label !== c.label && c.label.endsWith("(Kategorie)") ? `${label} (${t("discord.overview.purpose.category")})` : label;
}

/** A fixed message's kind in the active language. */
export const messageKindLabel = (m: Pick<BotMessage, "kind" | "kindLabel">) => tOr(`discord.overview.kind.${m.kind}`, m.kindLabel || m.kind);

/** What a fixed message is: its kind, and its title or category when it has one. */
export function messageName(m: BotMessage): string {
    const extra = m.title || m.categoryName;
    return extra ? `${messageKindLabel(m)} · ${extra}` : messageKindLabel(m);
}

/** The rights a channel lacks in the active language: from their keys when the server sends them, else its German labels. */
export function channelMissing(c: Pick<BotChannel, "missing" | "missingKeys">): string[] {
    if (!c.missingKeys || c.missingKeys.length !== c.missing.length) return c.missing;
    return c.missingKeys.map((key, i) => rightLabel({ key, label: c.missing[i] }));
}

/** "3 Nachrichten nicht geprüft": the fixed messages whose state the bot could not read, as a calm line ("" = none). */
export function uncheckedLine(messages: BotMessage[]): string {
    const n = messages.filter((m) => m.status === "unknown").length;
    return n ? t("discord.overview.attention.unchecked", { count: n }) : "";
}

/**
 * The points of one side that need attention, the bad ones first. Empty while the
 * bot cannot say anything (offline, no server) — the page shows that state itself.
 */
export function attentionItems(data: DiscordOverview, user: SessionUser | null): AttentionItem[] {
    if (!data.guildId || !data.online) return [];
    // Online, but the bot is not on this server (or misses its own member): nothing
    // below could be checked — one bad point instead of a false "Alles in Ordnung".
    if (!data.botCheck.known) {
        return [{
            id: "bot-absent", tone: "bad", status: t("discord.overview.status.unchecked"),
            what: t("discord.overview.attention.bot"), why: t("discord.overview.why.botAbsent"), action: null,
        }];
    }
    const link = (label: string, to: string) => (mayOpenHref(user, to) ? { label, to } : null);
    const out: AttentionItem[] = [];

    for (const f of data.botCheck.functions) {
        if (f.state !== "missing") continue;
        const missing = f.rights.filter((r) => r.ok === false).map(rightLabel);
        out.push({
            id: `fn-${f.key}`, tone: "bad", status: t("discord.overview.status.missing"),
            what: functionLabel(f), why: t("discord.overview.why.rights", { rights: missing.join(", ") }),
            action: link(t("discord.overview.action.checkRight"), "#bot-check"),
        });
    }

    data.botCheck.channels.forEach((c, i) => {
        if (c.state === "ok" || c.state === "unknown") return;
        const why = c.state === "not_set"
            ? t("discord.overview.why.channelNotSet")
            : c.state === "channel_missing"
                ? t("discord.overview.why.channelGone")
                : t("discord.overview.why.channelRights", { channel: c.channelName || c.channelId, rights: channelMissing(c).join(", ") });
        out.push({
            id: `ch-${c.key}-${i}`, tone: "bad",
            status: t(c.state === "channel_missing" ? "discord.overview.status.deleted" : "discord.overview.status.missing"),
            what: purposeLabel(c), why, action: link(t("discord.overview.action.assignChannel"), "/channels"),
        });
    });

    for (const r of data.botCheck.rolesAboveBot) {
        out.push({
            id: `role-${r.id}`, tone: "mid", status: t("discord.overview.status.hint"),
            what: r.name, why: t("discord.overview.why.aboveBot", { uses: r.usedBy.join(", ") }),
            action: link(t("discord.overview.action.toRole"), "/channels/server-roles"),
        });
    }

    for (const m of data.messages) {
        if (m.status !== "deleted" && m.status !== "channel_missing" && m.status !== "no_access") continue;
        const gone = m.status !== "no_access";
        const home = MESSAGE_HOME[m.kind];
        out.push({
            id: `msg-${m.kind}-${m.messageId || m.channelId || m.categoryId}`,
            tone: gone ? "bad" : "mid",
            status: t(gone ? "discord.overview.status.deleted" : "discord.overview.status.noAccess"),
            what: messageName(m),
            why: t(m.status === "deleted" ? "discord.overview.why.messageGone" : m.status === "channel_missing" ? "discord.overview.why.messageChannelGone" : "discord.overview.why.messageNoAccess"),
            // a message the bot cannot see is not reposted: the channel's rights are what is wrong
            action: gone
                ? (home ? link(t("discord.overview.action.repost"), home) : null)
                : link(t("discord.overview.action.checkChannelRights"), "/channels"),
        });
    }

    // Empty roles are no point of their own: the hygiene line under the list counts them.
    return out.map((item, i) => ({ item, i }))
        .sort((a, b) => TONE_ORDER[a.item.tone] - TONE_ORDER[b.item.tone] || a.i - b.i)
        .map((x) => x.item);
}

/** One line of the bot check: a function, the rights it needs, and its state on each server that is set up. */
export type BotCheckRow = {
    key: string;
    label: string;
    rights: { key: string; label: string }[];
    event: BotFunction | null;
    talk: BotFunction | null;
};

/**
 * The bot check of both servers side by side: one row per function (in the
 * server's order), the rights as the union of both sides. A side that is not
 * set up (or not loaded) passes null and its cells stay empty.
 */
export function botCheckRows(event: DiscordOverview | null, talk: DiscordOverview | null): BotCheckRow[] {
    const rows = new Map<string, BotCheckRow>();
    const add = (data: DiscordOverview | null, side: "event" | "talk") => {
        if (!data || !data.guildId) return;
        for (const f of data.botCheck.functions) {
            const row = rows.get(f.key) || { key: f.key, label: functionLabel(f), rights: [], event: null, talk: null };
            row[side] = f;
            for (const r of f.rights) if (!row.rights.some((x) => x.key === r.key)) row.rights.push({ key: r.key, label: rightLabel(r) });
            rows.set(f.key, row);
        }
    };
    add(event, "event");
    add(talk, "talk");
    return [...rows.values()];
}

/** How a function reads on one server: a word with its meaning colour, and the missing rights. */
export function functionState(f: BotFunction | null): { tone: "ok" | "bad" | "muted"; text: string; missing: string[] } {
    if (!f) return { tone: "muted", text: "–", missing: [] };
    if (f.state === "ok") return { tone: "ok", text: t("discord.overview.state.ok"), missing: [] };
    if (f.state === "missing") return { tone: "bad", text: t("discord.overview.status.missing"), missing: f.rights.filter((r) => r.ok === false).map(rightLabel) };
    if (f.state === "not_needed") return { tone: "muted", text: t("discord.overview.state.notNeeded"), missing: [] };
    return { tone: "muted", text: t("discord.overview.state.unknown"), missing: [] };
}

/** Sort rank of a bot-check row: a missing right first, then unknown, then fine. */
export function botCheckRank(row: BotCheckRow): number {
    const states = [row.event, row.talk].filter(Boolean).map((f) => f!.state);
    if (states.includes("missing")) return 0;
    if (states.includes("unknown")) return 1;
    return states.includes("ok") ? 2 : 3;
}

/** A fixed message's status: a word with its meaning colour; sort rank = worst first. */
export function messageStatus(m: BotMessage): { tone: "ok" | "bad" | "mid" | "muted"; text: string; rank: number } {
    if (m.status === "ok") return { tone: "ok", text: t("discord.overview.msgStatus.ok"), rank: 3 };
    if (m.status === "deleted") return { tone: "bad", text: t("discord.overview.msgStatus.deleted"), rank: 0 };
    if (m.status === "channel_missing") return { tone: "bad", text: t("discord.overview.msgStatus.channelMissing"), rank: 0 };
    if (m.status === "no_access") return { tone: "mid", text: t("discord.overview.msgStatus.noAccess"), rank: 1 };
    return { tone: "muted", text: t("discord.overview.msgStatus.unknown"), rank: 2 };
}

/** The calm line under the attention list: "48 Rollen · 3 ohne Mitglieder · 2 mit heiklen Rechten", parts the bot cannot count left out. */
export function hygieneLine(h: DiscordOverview["hygiene"]): string {
    if (!h.known || h.total === null) return "";
    const parts = [t("discord.overview.hygiene.total", { count: h.total })];
    if (h.empty !== null) parts.push(t("discord.overview.hygiene.empty", { count: h.empty }));
    if (h.sensitive !== null) parts.push(t("discord.overview.hygiene.sensitive", { count: h.sensitive }));
    return parts.join(" · ");
}

/** Seconds until "Neu prüfen" may ask Discord again (0 = now). */
export function refreshWait(lastAt: number, now: number, gapMs = 30000): number {
    if (!lastAt) return 0;
    const left = lastAt + gapMs - now;
    return left > 0 ? Math.ceil(left / 1000) : 0;
}
