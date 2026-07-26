// Same URL helpers as src/web/renderAdmin.js (eventPostUrl/raidplanUrl) — shared
// by the raids list and the "Alle Raids" tab on the history page.
export const eventPostUrl = (guildId: string, channelId: string, eventId: string) =>
    `https://discord.com/channels/${guildId}/${channelId}/${eventId}`;

export const raidplanUrl = (eventId: string) => `https://raid-helper.xyz/raidplan/${eventId}`;
