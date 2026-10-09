// Same URL helpers as src/web/renderAdmin.js (eventPostUrl/channelUrl/raidplanUrl) —
// shared by the raids list, the "Alle Raids" tab on the history page, and the
// raid detail page's meta header.

/**
 * An event of the EventHelper's own store (src/web/eventStore.js) — its id
 * carries the "eh-" prefix, a Raid-Helper id is a bare number. Only a
 * Raid-Helper event has a raidplan, and only its id is also the message id of
 * the post in Discord.
 */
export const isOwnEventId = (eventId: string) => String(eventId || "").startsWith("eh-");

export const channelUrl = (guildId: string, channelId: string) =>
    `https://discord.com/channels/${guildId}/${channelId}`;

/**
 * What the server knows about an event's channel (#537, services/discord/linkCheck.js):
 * "ok" = it exists, "missing" = deleted, "unknown" = the bot cannot tell.
 */
export type ChannelState = "ok" | "missing" | "unknown";

/** Whether a channel may be linked: only when the server says it exists (an answer without the field counts as before). */
export const channelLinkable = (state?: ChannelState) => !state || state === "ok";

/**
 * The event's post in Discord; for an own event its channel (the bot's message id is not the event id).
 * "" — no link — without ids or while the channel is not known to exist (#537: no dead links).
 */
export const eventPostUrl = (guildId: string, channelId: string, eventId: string, state?: ChannelState) => {
    if (!guildId || !channelId || !channelLinkable(state)) return "";
    return isOwnEventId(eventId)
        ? channelUrl(guildId, channelId)
        : `https://discord.com/channels/${guildId}/${channelId}/${eventId}`;
};

/** The Raid-Helper raidplan, "" for an own event (it has none — render no link). */
export const raidplanUrl = (eventId: string) =>
    isOwnEventId(eventId) ? "" : `https://raid-helper.xyz/raidplan/${eventId}`;

export const messageLink = (guildId: string, channelId: string, messageId: string) =>
    `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
