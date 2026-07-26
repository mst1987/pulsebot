// Same URL helpers as src/web/renderAdmin.js (eventPostUrl/channelUrl/raidplanUrl) —
// shared by the raids list, the "Alle Raids" tab on the history page, and the
// raid detail page's meta header.
export const eventPostUrl = (guildId: string, channelId: string, eventId: string) =>
    `https://discord.com/channels/${guildId}/${channelId}/${eventId}`;

export const channelUrl = (guildId: string, channelId: string) =>
    `https://discord.com/channels/${guildId}/${channelId}`;

export const raidplanUrl = (eventId: string) => `https://raid-helper.xyz/raidplan/${eventId}`;
