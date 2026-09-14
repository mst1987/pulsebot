import type { Channel, ChannelsData, PurposeStatus } from "../api";

// Pure helpers of the Kanäle page (design issue #216).

// Discord's channel type numbers (discord.js ChannelType).
export const TYPE_TEXT = 0;
export const TYPE_VOICE = 2;
export const TYPE_ANNOUNCEMENT = 5;
export const TYPE_STAGE = 13;
export const TYPE_FORUM = 15;

/** Channels a purpose can point at: text and announcement channels. */
export function isTextLike(channel: Pick<Channel, "type">): boolean {
    return channel.type === TYPE_TEXT || channel.type === TYPE_ANNOUNCEMENT;
}

/** Channels grouped under their Discord category, in server order; uncategorised first. */
export function groupByCategory(data: Pick<ChannelsData, "categories">, channels: Channel[]) {
    const groups: { id: string; name: string; channels: Channel[] }[] = [];
    const known = new Set(data.categories.map((k) => k.id));
    const loose = channels.filter((c) => !c.parentId || !known.has(c.parentId));
    if (loose.length) groups.push({ id: "", name: "Ohne Kategorie", channels: loose });
    for (const cat of data.categories) {
        groups.push({ id: cat.id, name: cat.name, channels: channels.filter((c) => c.parentId === cat.id) });
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
