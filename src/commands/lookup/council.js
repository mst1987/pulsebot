// /council <Item> — straight to the loot council's drop check for that item (#265).
// The drop check itself (candidates, simulation) is far too big for a Discord
// reply; the bot answers with what the item is and how often it went out, and
// the link.
const { SlashCommandBuilder } = require("discord.js");
const { RAID_ITEMS } = require("../../config/tbcLootNames");
const { itemCatalog } = require("../../services/loot/lootStats");
const { versionOfEvent } = require("../../services/events/mainVersion");
const { versionLinks } = require("../../services/events/versionSettings");
const { webUrl, lookupReply, respondChoices, clip } = require("../../utils/discord/botLookup");
const { addVersionOption, versionOfCommand, versionNote } = require("../../services/events/commandVersion");
const { councilContentFor } = require("../../config/councilContent");

/** The game version the command answers for: the `version` option, else the channel category's, else the main version (#743, #748). */
function versionOfInteraction(interaction) {
    return versionOfCommand(interaction).versionId;
}

/**
 * Every item the council can be asked about: all raid drops (the TBC catalogue -
 * only for a version that has an item table, #748) plus whatever was ever looted.
 */
function councilItems(versionId = "tbc") {
    const byId = new Map();
    if (councilContentFor(versionId).itemTable) {
        for (const [id, entry] of Object.entries(RAID_ITEMS)) {
            const name = Array.isArray(entry) ? entry[0] : "";
            if (name) byId.set(Number(id), name);
        }
    }
    for (const item of itemCatalog()) {
        if (item.itemId && item.itemName && !byId.has(item.itemId)) byId.set(item.itemId, item.itemName);
    }
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The Wowhead link of an item in the game version of the channel's category
 * (main version when the channel has none or the version has no Wowhead path).
 */
function itemLinkFor(itemId, channel, versionId = "") {
    if (versionId) return versionLinks(versionId).wowheadItem(itemId);
    const inThread = channel && typeof channel.isThread === "function" && channel.isThread();
    const holder = inThread ? channel.parent : channel;
    const categoryId = (holder && holder.parentId) || "";
    return versionLinks(versionOfEvent({ categoryId })).wowheadItem(itemId);
}

/** The item an option value names: an id (autocomplete, or typed) or a name. */
function findCouncilItem(value, versionId = "tbc") {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const items = councilItems(versionId);
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) return items.find((i) => i.id === id) || { id, name: `Item ${id}` };
    const lower = raw.toLowerCase();
    return items.find((i) => i.name.toLowerCase() === lower) || items.find((i) => i.name.toLowerCase().includes(lower)) || null;
}

module.exports = {
    name: "council",
    description: "Öffnet den Loot-Council-Drop-Check für ein Item.",
    group: "loot",
    defaultAccess: "admins",
    data: addVersionOption(new SlashCommandBuilder()
        .setName("council")
        .setDescription("Loot-Council: Drop-Check für ein Item öffnen")
        .addStringOption((o) => o.setName("item").setDescription("Item").setRequired(true).setAutocomplete(true))),
    findCouncilItem,
    itemLinkFor,
    async execute(interaction) {
        const value = interaction.options.getString("item");
        const versionId = versionOfInteraction(interaction);
        const footer = { text: versionNote(versionId) };
        const item = findCouncilItem(value, versionId);
        if (!item) {
            return lookupReply(interaction, {
                footer,
                title: "Item nicht gefunden",
                description: `Kein Raid-Item zu „${clip(value, 100)}“.`,
            }, [{ label: "Im Web öffnen", url: webUrl("/lootcouncil/drop") }]);
        }
        const looted = itemCatalog().find((i) => i.itemId === item.id);
        const history = looted
            ? `Schon **${looted.count}×** vergeben, zuletzt an ${looted.awards[0] ? `**${looted.awards[0].character}**` : "—"}.`
            : "Noch nie vergeben.";
        return lookupReply(interaction, {
            footer,
            title: item.name,
            url: itemLinkFor(item.id, interaction.channel, versionId),
            description: `${history}\nKandidaten, BiS und Simulation stehen im Drop-Check.`,
        }, [{ label: "Drop prüfen", url: webUrl(`/lootcouncil/drop/${item.id}`) }]);
    },
    async autocomplete(interaction) {
        return respondChoices(interaction, councilItems(versionOfInteraction(interaction)).map((i) => ({ name: i.name, value: String(i.id) })));
    },
};
