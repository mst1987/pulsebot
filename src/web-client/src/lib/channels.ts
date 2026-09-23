import type { Channel, ChannelArchiveRow, ChannelChanges, ChannelResult, ChannelsData, PurposeStatus } from "../api";
import { normalizeForType } from "./channelNames";

// Pure helpers of the Kanäle page (design issue #216, tree/bulk/archive #259).

/** The select value that means "unverändert" in the bulk edit. */
export const KEEP = "__keep";

/** The word a bulk delete is confirmed with — the server's BULK_DELETE_WORD. */
export const BULK_DELETE_WORD = "LÖSCHEN";

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
    if (!row.at) return "von Hand ins Archiv verschoben";
    const date = new Date(row.at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    return `archiviert am ${date}${row.by ? ` von ${row.by}` : ""}${row.fromCategory ? ` · aus ${row.fromCategory}` : ""}`;
}

/** Slowmode choices, as Discord offers them. */
export const SLOWMODE_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];

/** "aus", "30 s", "5 min", "2 h". */
export function slowmodeLabel(seconds: number): string {
    if (!seconds) return "aus";
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    return `${Math.round(seconds / 3600)} h`;
}

/** "Mi 17.09. 19:30" for an event start in seconds. */
export function eventDateLabel(startTime: number): string {
    if (!startTime) return "";
    const d = new Date(startTime * 1000);
    const day = d.toLocaleDateString("de-DE", { weekday: "short", timeZone: "Europe/Berlin" }).replace(".", "");
    const date = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });
    const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
    return `${day} ${date} ${time}`;
}

/**
 * Everything the tree does not print in the row, for the channel's tooltip: the
 * event, the topic, what the bot uses it for, slowmode, rights. The row itself
 * keeps only the name and the status badges.
 */
export function channelTip(channel: Channel, data: ChannelsData): { head: string; sub: string } {
    const parts: string[] = [];
    const ev = data.events?.[channel.id];
    if (ev) parts.push(`${ev.status === "past" ? "Vergangenes Event" : "Event"} ${ev.title} · ${eventDateLabel(ev.startTime)}.`);
    const details = data.details?.[channel.id];
    if (details?.topic) parts.push(`Thema: ${details.topic}`);
    const purposes = data.purposes.filter((p) => p.kind === "channel" && p.ids.includes(channel.id)).map((p) => p.label);
    if (purposes.length) parts.push(`Zweck: ${purposes.join(", ")}.`);
    const posts = data.recruitmentPosts?.[channel.id] || 0;
    if (posts) parts.push(`${posts} Recruitment-${posts === 1 ? "Aushang" : "Aushänge"}.`);
    if (details?.rateLimitPerUser) parts.push(`Slowmode ${slowmodeLabel(details.rateLimitPerUser)}.`);
    if (details?.permissionsLocked === true) parts.push("Rechte von der Kategorie.");
    else if (details?.permissionsLocked === false) parts.push("Eigene Rechte.");
    if (data.connected && channel.botCanView === false) parts.push("Bot sieht den Kanal nicht.");
    else if (data.connected && isTextLike(channel) && channel.botCanSend === false) parts.push("Bot darf nicht schreiben.");
    if (channel.type !== TYPE_TEXT) parts.push(`Typ: ${channel.typeLabel}.`);
    return { head: `#${channel.name}`, sub: parts.join(" ") || "Kein Thema, kein Zweck, kein Event." };
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
        out.push(`#${channel.name} gehört zum anstehenden Event „${ev.title}“ (${eventDateLabel(ev.startTime)}) — die Anmelde-Nachricht geht mit verloren.`);
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
            results.push({ id: ids[i], ok: false, error: (err as Error).message || "Fehler" });
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
    let message = `${done} ${done === 1 ? "Kanal" : "Kanäle"} ${verb}`;
    if (failed.length) message += `, ${failed.length} fehlgeschlagen${reasons.length ? `: ${reasons.join(", ")}` : ""}`;
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
    for (const t of channels) {
        if (!t.isThread) continue;
        if (t.parentId && topIds.has(t.parentId)) {
            const list = threadsByParent.get(t.parentId) || [];
            list.push(t);
            threadsByParent.set(t.parentId, list);
        } else {
            orphanThreads.push(t);
        }
    }
    const withThreads = (list: Channel[]): ChannelNode[] => list.map((c) => ({ ...c, threads: threadsByParent.get(c.id) || [] }));
    const loose = [...top.filter((c) => !c.parentId || !known.has(c.parentId)), ...orphanThreads];
    if (loose.length) groups.push({ id: "", name: "Ohne Kategorie", channels: withThreads(loose) });
    for (const cat of data.categories) {
        groups.push({ id: cat.id, name: cat.name, channels: withThreads(top.filter((c) => c.parentId === cat.id)) });
    }
    return groups;
}

/**
 * What the bot may do in a channel, judged by what a purpose needs — the client
 * twin of channelStatus() in src/web/channelPurposes.js, for channels that are
 * not assigned yet (the pickers in the dialogs). Null while the bot is offline.
 */
export function rightsStatus(channel: Channel, need: "send" | "read" | null, connected: boolean): PurposeStatus | null {
    if (!connected) return null;
    if (channel.botCanView === false) {
        return { tone: "mid", label: "Bot sieht den Kanal nicht", tip: `Der Bot-Rolle fehlt in #${channel.name} das Recht „Kanal ansehen“. Auswählbar, wirkt aber erst, wenn das Recht in Discord gesetzt ist.` };
    }
    if (channel.botCanSend === false) {
        return { tone: "mid", label: "Bot darf nicht schreiben", tip: `Der Bot-Rolle fehlt in #${channel.name} das Recht „Nachrichten senden“.` };
    }
    return need === "read"
        ? { tone: "ok", label: "Bot liest mit", tip: `Der Bot sieht #${channel.name} und kann dort antworten.` }
        : { tone: "ok", label: "Bot schreibt", tip: `Der Bot darf in #${channel.name} posten.` };
}

/** A category's own naming schema, or "" (none, or only the default an old quick-create stored). */
export function ownSchemaOf(data: Pick<ChannelsData, "schemas" | "defaultSchema">, categoryId: string): string {
    const schema = data.schemas?.[categoryId]?.schema || "";
    return schema && schema !== data.defaultSchema ? schema : "";
}
