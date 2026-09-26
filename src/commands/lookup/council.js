// /council <Item> — straight to the loot council's drop check for that item (#265).
// The drop check itself (candidates, simulation) is far too big for a Discord
// reply; the bot answers with what the item is and how often it went out, and
// the link.
const { SlashCommandBuilder } = require("discord.js");
const { RAID_ITEMS } = require("../../config/tbcLootNames");
const { itemCatalog } = require("../../web/lootStats");
const { itemLink } = require("../../utils/wowhead");
const { webUrl, lookupReply, respondChoices, clip } = require("../../utils/botLookup");

/** Every item the council can be asked about: all raid drops plus whatever was ever looted. */
function councilItems() {
    const byId = new Map();
    for (const [id, entry] of Object.entries(RAID_ITEMS)) {
        const name = Array.isArray(entry) ? entry[0] : "";
        if (name) byId.set(Number(id), name);
    }
    for (const item of itemCatalog()) {
        if (item.itemId && item.itemName && !byId.has(item.itemId)) byId.set(item.itemId, item.itemName);
    }
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The item an option value names: an id (autocomplete, or typed) or a name. */
function findCouncilItem(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const items = councilItems();
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
    data: new SlashCommandBuilder()
        .setName("council")
        .setDescription("Loot-Council: Drop-Check für ein Item öffnen")
        .addStringOption((o) => o.setName("item").setDescription("Item").setRequired(true).setAutocomplete(true)),
    findCouncilItem,
    async execute(interaction) {
        const value = interaction.options.getString("item");
        const item = findCouncilItem(value);
        if (!item) {
            return lookupReply(interaction, {
                title: "Item nicht gefunden",
                description: `Kein Raid-Item zu „${clip(value, 100)}“.`,
            }, [{ label: "Im Web öffnen", url: webUrl("/lootcouncil/drop") }]);
        }
        const looted = itemCatalog().find((i) => i.itemId === item.id);
        const history = looted
            ? `Schon **${looted.count}×** vergeben, zuletzt an ${looted.awards[0] ? `**${looted.awards[0].character}**` : "—"}.`
            : "Noch nie vergeben.";
        return lookupReply(interaction, {
            title: item.name,
            url: itemLink(item.id),
            description: `${history}\nKandidaten, BiS und Simulation stehen im Drop-Check.`,
        }, [{ label: "Drop prüfen", url: webUrl(`/lootcouncil/drop/${item.id}`) }]);
    },
    async autocomplete(interaction) {
        return respondChoices(interaction, councilItems().map((i) => ({ name: i.name, value: String(i.id) })));
    },
};
