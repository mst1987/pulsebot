import type { Channel, ChannelArchiveRow, ChannelChanges, ChannelPurpose, ChannelResult, ChannelsData, PurposeStatus } from "../api";
import { normalizeForType } from "./channelNames";
import { formatDateTime, formatWith } from "./format";
import { t, tOr } from "../i18n";

// Pure helpers of the Kanäle page (design issue #216, tree/bulk/archive #259).

/** The select value that means "unverändert" in the bulk edit. */
export const KEEP = "__keep";

/**
 * The word a bulk delete is confirmed with — the server's BULK_DELETE_WORD
 * ("LOESCHEN" with an umlaut). A protocol value the server checks, not a text to
 * translate: it is the same in every language, hence the escape (the i18n guard
 * looks for umlauts in texts).
 */
export const BULK_DELETE_WORD = "L\u00d6SCHEN";

/**
 * What the bulk edit form turns into: only the fields that are not
 * "unverändert". An empty topic stays unchanged; "Thema leeren" clears it.
 */
export function bulkChanges(form: { parentId: string; topic: string; clearTopic: boolean; slowmode: string }): ChannelChanges {
    const changes: ChannelChanges = {};
    if (form.parentId !== KEEP) changes.parentId = form.parentId;
    if (form.clearTopic) changes.topic = "";
    else if (form.topic.trim()) changes.topic = form.topic;
    if (form.slowmode !== KEEP) changes.rateLimitPerUser = Number(form.slowmode);
    return changes;
}

/** The fields of the full edit that differ from the channel as it is. */
export function changedFields(channel: Channel, data: ChannelsData, form: { name: string; topic: string; parentId: string; slowmode: number }): ChannelChanges {
    const details = data.details?.[channel.id];
    const changes: ChannelChanges = {};
    const name = normalizeForType(form.name, channel.type);
    if (name && name !== channel.name) changes.name = name;
    if (form.topic !== (details?.topic || "")) changes.topic = form.topic;
    if (form.parentId !== (channel.parentId || "")) changes.parentId = form.parentId;
    if (form.slowmode !== (details?.rateLimitPerUser || 0)) changes.rateLimitPerUser = form.slowmode;
    return changes;
}

/** "archiviert am 03.09.2026 von Nerathil · aus Mittwoch-Raid" / "von Hand verschoben". */
export function archivedLabel(row: ChannelArchiveRow): string {
    if (!row.at) return t("channels.lib.archivedByHand");
    const date = formatWith(row.at, { day: "2-digit", month: "2-digit", year: "numeric" });
    const by = row.by ? ` ${t("channels.lib.archivedBy", { name: row.by })}` : "";
    const from = row.fromCategory ? ` · ${t("channels.lib.archivedFrom", { category: row.fromCategory })}` : "";
    return `${t("channels.lib.archivedAt", { date })}${by}${from}`;
}

/** Slowmode choices, as Discord offers them. */
export const SLOWMODE_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];

/** "aus", "30 s", "5 min", "2 h". */
export function slowmodeLabel(seconds: number): string {
    if (!seconds) return t("channels.lib.slowmodeOff");
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    return `${Math.round(seconds / 3600)} h`;
}

/** "Mi 17.09. 19:30" for an event start in seconds. */
export function eventDateLabel(startTime: number): string {
    if (!startTime) return "";
    return formatDateTime(startTime * 1000);
}

/** A Discord channel type in the page's language; the server's label for a type the client does not know. */
export function channelTypeLabel(channel: Pick<Channel, "type" | "typeLabel">): string {
    return tOr(`channels.types.${channel.type}`, channel.typeLabel);
}

/** A purpose's name in the page's language — the server's label for one the client does not know. */
export function purposeLabel(purpose: Pick<ChannelPurpose, "id" | "label">): string {
    return tOr(`channels.purposes.${purpose.id}.label`, purpose.label);
}

/** A purpose's explanation in the page's language — the server's hint for one the client does not know. */
export function purposeHint(purpose: Pick<ChannelPurpose, "id" | "hint">): string {
    return tOr(`channels.purposes.${purpose.id}.hint`, purpose.hint);
}

/** A naming-schema placeholder's explanation in the page's language (the server's hint as fallback). */
export function placeholderHint(placeholder: { key: string; hint: string }): string {
    return tOr(`channels.placeholders.${placeholder.key}`, placeholder.hint);
}

/**
 * Everything the tree does not print in the row, for the channel's tooltip: the
 * event, the topic, what the bot uses it for, slowmode, rights. The row itself
 * keeps only the name and the status badges.
 */
export function channelTip(channel: Channel, data: ChannelsData): { head: string; sub: string } {
    const parts: string[] = [];
    const ev = data.events?.[channel.id];
    if (ev) parts.push(t(ev.status === "past" ? "channels.lib.tipPastEvent" : "channels.lib.tipEvent", { title: ev.title, date: eventDateLabel(ev.startTime) }));
    const details = data.details?.[channel.id];
    if (details?.topic) parts.push(t("channels.lib.tipTopic", { topic: details.topic }));
    const purposes = data.purposes.filter((p) => p.kind === "channel" && p.ids.includes(channel.id)).map(purposeLabel);
    if (purposes.length) parts.push(t("channels.lib.tipPurpose", { purposes: purposes.join(", ") }));
    const posts = data.recruitmentPosts?.[channel.id] || 0;
    if (posts) parts.push(t("channels.lib.tipPosts", { count: posts }));
    if (details?.rateLimitPerUser) parts.push(t("channels.lib.tipSlowmode", { value: slowmodeLabel(details.rateLimitPerUser) }));
    if (details?.permissionsLocked === true) parts.push(t("channels.lib.tipRightsCategory"));
    else if (details?.permissionsLocked === false) parts.push(t("channels.lib.tipRightsOwn"));
    if (data.connected && channel.botCanView === false) parts.push(t("channels.lib.tipBotCantView"));
    else if (data.connected && isTextLike(channel) && channel.botCanSend === false) parts.push(t("channels.lib.tipBotCantSend"));
    if (channel.type !== TYPE_TEXT) parts.push(t("channels.lib.tipType", { type: channelTypeLabel(channel) }));
    return { head: `#${channel.name}`, sub: parts.join(" ") || t("channels.lib.tipNothing") };
}

/**
 * What deleting these channels from the list takes along, one line each: a
 * channel whose event is still ahead loses its signup message with it. Asked
 * before the name is typed; a past event's channel says nothing (its raid is over).
 */
export function deleteWarnings(ids: string[], data: ChannelsData): string[] {
    const out: string[] = [];
    for (const id of ids) {
        const channel = data.channels.find((c) => c.id === id);
        const ev = data.events?.[id];
        if (!channel || !ev || ev.status === "past") continue;
        out.push(t("channels.lib.deleteWarning", { name: channel.name, title: ev.title, date: eventDateLabel(ev.startTime) }));
    }
    return out;
}

/** The channels of past events that are not archived yet — "alle vergangenen archivieren". */
export function pastEventChannels(data: ChannelsData): Channel[] {
    const archiveId = data.archive?.categoryId || "";
    return data.channels.filter((c) => data.events?.[c.id]?.status === "past" && (!archiveId || c.parentId !== archiveId));
}

/** The pause between two Discord changes; Discord bounces bursts with a 429. */
export const STEP_PAUSE_MS = 400;

/**
 * Run a change channel by channel with a short pause, reporting progress after
 * each one — the job toast shows it. Never throws: a failed request becomes a
 * failed result for that channel.
 */
export async function runInSteps(
    ids: string[],
    step: (id: string) => Promise<ChannelResult[]>,
    { onProgress, pauseMs = STEP_PAUSE_MS }: { onProgress?: (done: number, total: number) => void; pauseMs?: number } = {},
): Promise<ChannelResult[]> {
    const results: ChannelResult[] = [];
    for (let i = 0; i < ids.length; i++) {
        if (i > 0 && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
        try {
            results.push(...await step(ids[i]));
        } catch (err) {
            results.push({ id: ids[i], ok: false, error: (err as Error).message || t("common.error") });
        }
        onProgress?.(i + 1, ids.length);
    }
    return results;
}

/** "3 Kanäle geändert, 1 fehlgeschlagen: fehlende Rechte" — the client twin of channelOps.summarize(). */
export function resultMessage(results: ChannelResult[], verb: string): { message: string; failed: number } {
    const done = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    const reasons = [...new Set(failed.map((r) => r.error).filter(Boolean))];
    let message = t("channels.lib.resultDone", { count: done, verb });
    if (failed.length) message += `, ${t("channels.lib.resultFailed", { count: failed.length })}${reasons.length ? `: ${reasons.join(", ")}` : ""}`;
    return { message, failed: failed.length };
}

// Discord's channel type numbers (discord.js ChannelType).
export const TYPE_TEXT = 0;
export const TYPE_VOICE = 2;
export const TYPE_ANNOUNCEMENT = 5;
export const TYPE_ANNOUNCEMENT_THREAD = 10;
export const TYPE_PUBLIC_THREAD = 11;
export const TYPE_PRIVATE_THREAD = 12;
export const TYPE_STAGE = 13;
export const TYPE_FORUM = 15;

/** Channels a purpose can point at: text and announcement channels. */
export function isTextLike(channel: Pick<Channel, "type">): boolean {
    return channel.type === TYPE_TEXT || channel.type === TYPE_ANNOUNCEMENT;
}

/** A channel as the tree shows it: with the threads that hang off it, if any (#361). */
export type ChannelNode = Channel & { threads: Channel[] };
export type CategoryGroup = { id: string; name: string; channels: ChannelNode[] };

/**
 * Channels grouped under their Discord category, in server order; uncategorised
 * first. A thread's parentId names the text channel it hangs off, not a
 * category (#361), so it nests under that channel (`ChannelNode.threads`)
 * instead of falling into "Ohne Kategorie" itself; only a thread whose parent
 * channel is not in `channels` (e.g. already filtered out, or deleted) falls
 * back to a loose row of its own.
 */
export function groupByCategory(data: Pick<ChannelsData, "categories">, channels: Channel[]): CategoryGroup[] {
    const groups: CategoryGroup[] = [];
    const known = new Set(data.categories.map((k) => k.id));
    const top = channels.filter((c) => !c.isThread);
    const topIds = new Set(top.map((c) => c.id));
    const threadsByParent = new Map<string, Channel[]>();
    const orphanThreads: Channel[] = [];
    for (const th of channels) {
        if (!th.isThread) continue;
        if (th.parentId && topIds.has(th.parentId)) {
            const list = threadsByParent.get(th.parentId) || [];
            list.push(th);
            threadsByParent.set(th.parentId, list);
        } else {
            orphanThreads.push(th);
        }
    }
    const withThreads = (list: Channel[]): ChannelNode[] => list.map((c) => ({ ...c, threads: threadsByParent.get(c.id) || [] }));
    const loose = [...top.filter((c) => !c.parentId || !known.has(c.parentId)), ...orphanThreads];
    if (loose.length) groups.push({ id: "", name: t("channels.noCategory"), channels: withThreads(loose) });
    for (const cat of data.categories) {
        groups.push({ id: cat.id, name: cat.name, channels: withThreads(top.filter((c) => c.parentId === cat.id)) });
    }
    return groups;
}

/**
 * A group's name for display: the loose group ("Ohne Kategorie") in the page's
 * current language, even when the groups were computed (and memoised) before a
 * language switch.
 */
export function groupName(group: Pick<CategoryGroup, "id" | "name">): string {
    return group.id ? group.name : t("channels.noCategory");
}

/**
 * What the bot may do in a channel, judged by what a purpose needs — the client
 * twin of channelStatus() in src/web/channelPurposes.js, for channels that are
 * not assigned yet (the pickers in the dialogs). Null while the bot is offline.
 */
export function rightsStatus(channel: Channel, need: "send" | "read" | null, connected: boolean): PurposeStatus | null {
    if (!connected) return null;
    if (channel.botCanView === false) {
        return { tone: "mid", label: t("channels.lib.rights.cantView"), tip: t("channels.lib.rights.cantViewTip", { name: channel.name }) };
    }
    if (channel.botCanSend === false) {
        return { tone: "mid", label: t("channels.lib.rights.cantSend"), tip: t("channels.lib.rights.cantSendTip", { name: channel.name }) };
    }
    return need === "read"
        ? { tone: "ok", label: t("channels.lib.rights.reads"), tip: t("channels.lib.rights.readsTip", { name: channel.name }) }
        : { tone: "ok", label: t("channels.lib.rights.writes"), tip: t("channels.lib.rights.writesTip", { name: channel.name }) };
}

/** A category's own naming schema, or "" (none, or only the default an old quick-create stored). */
export function ownSchemaOf(data: Pick<ChannelsData, "schemas" | "defaultSchema">, categoryId: string): string {
    const schema = data.schemas?.[categoryId]?.schema || "";
    return schema && schema !== data.defaultSchema ? schema : "";
}
