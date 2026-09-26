// /raid <Event> — one raid at a glance: when, where, how many signed up, and
// where the asking user stands; the full detail page is one click away (#265).
const { SlashCommandBuilder } = require("discord.js");
const { DateTime } = require("luxon");
const { listEvents, statusOf, statusCounts, STATUS_LABELS, STATUS_ICONS } = require("../../web/eventLookup");
const { eventGuildId } = require("../../web/guildRoles");
const { webUrl, lookupReply, deferLookup, discordTime, respondChoices, clip } = require("../../utils/botLookup");

/** "Mi 24.09. 20:00" in the guild's time zone — autocomplete names cannot carry Discord timestamps. */
function shortDate(startTime) {
    if (!startTime) return "";
    return DateTime.fromSeconds(Number(startTime), { zone: "Europe/Berlin" }).setLocale("de").toFormat("ccc dd.MM. HH:mm");
}

/** Upcoming raids first (soonest on top), then the past ones (newest on top). */
function pickOrder(events, now = Date.now() / 1000) {
    const upcoming = events.filter((e) => (e.startTime || 0) >= now - 3 * 3600);
    const past = events.filter((e) => (e.startTime || 0) < now - 3 * 3600).reverse();
    return [...upcoming, ...past];
}

/** The event an option value names: its id (autocomplete) or a typed title. */
function findEvent(events, value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const byId = events.find((e) => String(e.id) === raw);
    if (byId) return byId;
    const lower = raw.toLowerCase();
    return pickOrder(events).find((e) => String(e.title || "").toLowerCase().includes(lower)) || null;
}

module.exports = {
    name: "raid",
    description: "Ein Raid im Überblick: Termin, Anmeldestand, dein Status.",
    group: "raids",
    defaultAccess: "everyone",
    data: new SlashCommandBuilder()
        .setName("raid")
        .setDescription("Ein Raid im Überblick: Termin, Anmeldestand, dein Status")
        .addStringOption((o) => o.setName("event").setDescription("Raid").setRequired(true).setAutocomplete(true)),
    shortDate,
    async execute(interaction) {
        await deferLookup(interaction);
        const value = interaction.options.getString("event");
        const { events, error } = await listEvents({ past: true });
        const event = findEvent(events, value);
        if (!event) {
            return lookupReply(interaction, {
                title: "Raid nicht gefunden",
                description: error ? `Die Raids konnten nicht geladen werden: ${clip(error, 200)}` : `Kein Raid zu „${clip(value, 100)}“.`,
            }, [{ label: "Im Web öffnen", url: webUrl("/raids") }]);
        }
        const counts = statusCounts(event);
        const mine = statusOf(event, interaction.user.id);
        const others = ["late", "tentative", "bench", "absence"]
            .filter((k) => counts[k])
            .map((k) => `${counts[k]} ${STATUS_LABELS[k]}`)
            .join(" · ");
        const where = [event.categoryName, event.channelId ? `<#${event.channelId}>` : ""].filter(Boolean).join(" · ");
        const fields = [
            { name: "Anmeldungen", value: `**${counts.signed + counts.late}**${others ? `\n${others}` : ""}`, inline: true },
            { name: "Du", value: mine ? `${STATUS_ICONS[mine]} ${STATUS_LABELS[mine]}` : "⚪ nicht reagiert", inline: true },
        ];
        if (event.leaderId) fields.push({ name: "Raidleitung", value: `<@${event.leaderId}>`, inline: true });

        // Events live on the event server, whichever server the command came from.
        const guildId = eventGuildId() || (interaction.guild && interaction.guild.id) || "";
        const links = [{ label: "Im Web öffnen", url: webUrl(`/raids/detail?event=${encodeURIComponent(event.id)}`) }];
        if (event.channelId && guildId) links.push({ label: "Zum Kanal", url: `https://discord.com/channels/${guildId}/${event.channelId}` });
        return lookupReply(interaction, {
            title: event.title || "Raid",
            description: `${discordTime(event.startTime, "F")} (${discordTime(event.startTime, "R")})${where ? `\n${where}` : ""}`,
            fields,
        }, links);
    },
    async autocomplete(interaction) {
        const { events } = await listEvents({ past: true });
        return respondChoices(interaction, pickOrder(events).map((e) => ({
            name: [e.title || "Raid", shortDate(e.startTime)].filter(Boolean).join(" · "),
            value: String(e.id),
        })));
    },
};
