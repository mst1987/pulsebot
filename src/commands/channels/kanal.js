// /kanal umbenennen · /kanal archivieren · /kanal anlegen — the everyday channel
// work of the Kanäle page from Discord (issue #259, bot part). The same modules
// do the work (discordChannels.js, channelArchiveStore.js, utils/channelNames.js),
// so the rules are the page's: Discord's naming rules, archiving takes the right
// to write away and is logged. Deleting stays in the web menu, from the archive.
const { ChannelType } = require("discord.js");
const discord = require("../../web/discord");
const discordChannels = require("../../web/discordChannels");
const archiveStore = require("../../web/channelArchiveStore");
const { DEFAULT_SCHEMA, normalizeChannelName, renderChannelName, parseDay } = require("../../utils/channelNames");
const { webUrl, lookupReply, deferLookup, clip } = require("../../utils/botLookup");

const LINK = () => [{ label: "Im Web öffnen", url: webUrl("/channels") }];
const DATE_PLACEHOLDER = /\{(tag|dd|mm|yy|yyyy)\}/i;

const guildOf = (interaction) => String((interaction.guild && interaction.guild.id) || interaction.guildId || "");

/** Whether a picked channel belongs to the server the command came from. */
function sameGuild(interaction, channel) {
    const own = guildOf(interaction);
    const theirs = String((channel && (channel.guildId || (channel.guild && channel.guild.id))) || "");
    return !!own && (!theirs || theirs === own);
}

/** "24.09.2026", "24.09." or "2026-09-24" → "2026-09-24"; "" when it is no day. */
function parseDate(value, now = new Date()) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (parseDay(raw)) return raw;
    const match = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$/.exec(raw);
    if (!match) return "";
    let year = match[3] ? Number(match[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    const iso = `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    return parseDay(iso) ? iso : "";
}

const fail = (interaction, title, message) => lookupReply(interaction, { title, description: message, color: 0xe5534b }, LINK());

async function rename(interaction) {
    const channel = interaction.options.getChannel("kanal");
    const name = interaction.options.getString("name");
    if (!channel || !sameGuild(interaction, channel)) return fail(interaction, "Nicht umbenannt", "Der Kanal liegt nicht auf diesem Server.");
    await deferLookup(interaction);
    try {
        const result = await discordChannels.editChannel(channel.id, { name });
        if (!result.changed.includes("name")) {
            return lookupReply(interaction, { title: "Nichts geändert", description: `<#${channel.id}> heißt schon **${clip(result.name, 100)}**.` }, LINK());
        }
        return lookupReply(interaction, {
            title: "Kanal umbenannt",
            description: `**${clip(channel.name, 100)}** → **${clip(result.name, 100)}**\n<#${channel.id}>`,
        }, LINK());
    } catch (e) {
        return fail(interaction, "Nicht umbenannt", discordChannels.discordErrorText(e));
    }
}

async function archive(interaction) {
    const channel = interaction.options.getChannel("kanal");
    if (!channel || !sameGuild(interaction, channel)) return fail(interaction, "Nicht archiviert", "Der Kanal liegt nicht auf diesem Server.");
    const guildId = guildOf(interaction);
    const { archiveCategoryId } = archiveStore.getChannelConfig(guildId);
    if (!archiveCategoryId) {
        return fail(interaction, "Nicht archiviert", "Für diesen Server ist keine Archiv-Kategorie festgelegt — das geht im Menü unter Kanäle → Archiv.");
    }
    if (channel.parentId === archiveCategoryId) {
        return lookupReply(interaction, { title: "Schon im Archiv", description: `<#${channel.id}> liegt bereits im Archiv.` }, LINK());
    }
    await deferLookup(interaction);
    try {
        const archived = await discordChannels.archiveChannel(channel.id, archiveCategoryId);
        archiveStore.recordArchived({
            ...archived, channelId: channel.id, guildId,
            by: interaction.user.id, byName: interaction.user.globalName || interaction.user.username || "",
        });
        return lookupReply(interaction, {
            title: "Kanal archiviert",
            description: `**${clip(archived.name, 100)}**${archived.fromCategory ? ` aus ${clip(archived.fromCategory, 100)}` : ""}\nSchreibrechte entzogen. Gelöscht wird nur im Menü.`,
        }, LINK());
    } catch (e) {
        return fail(interaction, "Nicht archiviert", discordChannels.discordErrorText(e));
    }
}

async function create(interaction) {
    const category = interaction.options.getChannel("kategorie");
    if (!category || !sameGuild(interaction, category)) return fail(interaction, "Nicht angelegt", "Die Kategorie liegt nicht auf diesem Server.");
    if (category.type !== undefined && category.type !== ChannelType.GuildCategory) {
        return fail(interaction, "Nicht angelegt", "Bitte eine Kategorie wählen.");
    }
    const guildId = guildOf(interaction);
    const stored = (archiveStore.getChannelConfig(guildId).schemas || {})[category.id] || {};
    const typed = String(interaction.options.getString("name") || "").trim();
    const dateInput = interaction.options.getString("datum");
    const date = parseDate(dateInput);
    if (dateInput && !date) return fail(interaction, "Nicht angelegt", `„${clip(dateInput, 40)}“ ist kein Datum (z. B. 24.09. oder 2026-09-24).`);
    const raid = String(interaction.options.getString("raid") || stored.raid || "").trim();

    // A typed name with placeholders is a schema; no name at all means the
    // category's stored schema (or the default one).
    const schema = typed ? (typed.includes("{") ? typed : "") : (stored.schema || DEFAULT_SCHEMA);
    if (schema && DATE_PLACEHOLDER.test(schema) && !date) {
        return fail(interaction, "Nicht angelegt", `Das Schema \`${clip(schema, 100)}\` braucht ein Datum (Option „datum“).`);
    }
    const name = schema ? renderChannelName(schema, { date, raid }) : normalizeChannelName(typed);
    if (!name) return fail(interaction, "Nicht angelegt", "Der Name ist leer.");
    const exists = discord.listAllChannels(guildId).some((c) => String(c.name).toLowerCase() === name);
    if (exists) return fail(interaction, "Nicht angelegt", `Einen Kanal **${name}** gibt es schon.`);

    await deferLookup(interaction);
    try {
        const created = await discordChannels.createFromTemplate(guildId, {
            name, parentId: category.id, templateChannelId: stored.templateChannelId || "",
        });
        return lookupReply(interaction, {
            title: "Kanal angelegt",
            description: `<#${created.id}> in **${clip(category.name, 100)}**${stored.templateChannelId ? "\nRechte und Thema von der Vorlage übernommen." : ""}`,
        }, LINK());
    } catch (e) {
        return fail(interaction, "Nicht angelegt", discordChannels.discordErrorText(e));
    }
}

const HANDLERS = { umbenennen: rename, archivieren: archive, anlegen: create };

module.exports = {
    name: "kanal",
    description: "Kanal umbenennen, archivieren oder anlegen (Löschen nur im Menü).",
    group: "channels",
    defaultAccess: "admins",
    parseDate,
    async execute(interaction) {
        const handler = HANDLERS[interaction.options.getSubcommand()];
        if (!handler) return fail(interaction, "Unbekannt", "Diese Aktion gibt es nicht.");
        return handler(interaction);
    },
};
