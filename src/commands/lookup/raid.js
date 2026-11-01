// /raid <Event> — one raid at a glance: when, where, how many signed up, and
// where the asking user stands; the full detail page is one click away (#265).
const { SlashCommandBuilder } = require("discord.js");
const { DateTime } = require("luxon");
const { listEvents, statusOf, statusCounts, STATUS_LABELS, STATUS_ICONS } = require("../../services/events/eventLookup");
const { serverIds } = require("../../services/discord/roles/guildRoles");
const linkCheck = require("../../services/discord/linkCheck");
const { webUrl, lookupReply, deferLookup, discordTime, respondChoices, clip } = require("../../utils/discord/botLookup");
const { addVersionOption, versionOfCommand, eventsOfVersion, versionNote } = require("../../services/versions/commandVersion");
const { TIMEZONE } = require("../../config/timezone");
const { nameAndMention, nameFromSignups } = require("../../utils/discord/mentionName");

/** "Mi 24.09. 20:00" in the guild's time zone — autocomplete names cannot carry Discord timestamps. */
function shortDate(startTime) {
    if (!startTime) return "";
    return DateTime.fromSeconds(Number(startTime), { zone: TIMEZONE }).setLocale("de").toFormat("ccc dd.MM. HH:mm");
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
    data: addVersionOption(new SlashCommandBuilder()
        .setName("raid")
        .setDescription("Ein Raid im Überblick: Termin, Anmeldestand, dein Status")
        .addStringOption((o) => o.setName("event").setDescription("Raid").setRequired(true).setAutocomplete(true))),
    shortDate,
    async execute(interaction) {
        await deferLookup(interaction);
        const value = interaction.options.getString("event");
        const { versionId } = versionOfCommand(interaction);
        const { events: all, error } = await listEvents({ past: true });
        const event = findEvent(eventsOfVersion(all, versionId), value);
        const footer = { text: versionNote(versionId) };
        if (!event) {
            return lookupReply(interaction, {
                footer,
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
        // the lead's character as text first (when they signed up): the mention alone can read "@unknown-user"
        const leader = event.leaderId ? nameAndMention(nameFromSignups(event.signUps, event.leaderId), event.leaderId) : "";
        if (leader) fields.push({ name: "Raidleitung", value: leader, inline: true });

        // The raid's own server, whichever server the command came from.
        const guildId = event.guildId || serverIds()[0] || (interaction.guild && interaction.guild.id) || "";
        const links = [{ label: "Im Web öffnen", url: webUrl(`/raids/detail?event=${encodeURIComponent(event.id)}`) }];
        // only a channel that exists (#537)
        const channelUrl = linkCheck.channelLink(guildId, event.channelId);
        if (channelUrl) links.push({ label: "Zum Kanal", url: channelUrl });
        return lookupReply(interaction, {
            title: event.title || "Raid",
            description: `${discordTime(event.startTime, "d")} ${discordTime(event.startTime, "t")} (${discordTime(event.startTime, "R")})${where ? `\n${where}` : ""}`,
            fields,
            footer,
        }, links);
    },
    async autocomplete(interaction) {
        const { events: all } = await listEvents({ past: true });
        const events = eventsOfVersion(all, versionOfCommand(interaction).versionId);
        return respondChoices(interaction, pickOrder(events).map((e) => ({
            name: [e.title || "Raid", shortDate(e.startTime)].filter(Boolean).join(" · "),
            value: String(e.id),
        })));
    },
};
