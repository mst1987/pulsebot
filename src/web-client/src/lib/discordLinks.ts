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

/** The event's post in Discord; for an own event its channel (the bot's message id is not the event id). */
export const eventPostUrl = (guildId: string, channelId: string, eventId: string) =>
    isOwnEventId(eventId)
        ? channelUrl(guildId, channelId)
        : `https://discord.com/channels/${guildId}/${channelId}/${eventId}`;

/** The Raid-Helper raidplan, "" for an own event (it has none — render no link). */
export const raidplanUrl = (eventId: string) =>
    isOwnEventId(eventId) ? "" : `https://raid-helper.xyz/raidplan/${eventId}`;

export const messageLink = (guildId: string, channelId: string, messageId: string) =>
    `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
