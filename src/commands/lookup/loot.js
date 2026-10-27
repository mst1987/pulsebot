// /loot ich · /loot item <Item> · /loot raider <Name> — who got what, as a short
// answer with a link to Historie & Loot (issue #265). The numbers come from the
// same functions the web pages use (lootStore, lootStats), never from a second
// reading of the loot file.
const { SlashCommandBuilder } = require("discord.js");
const { listAll, listByCharacter } = require("../../stores/lootStore");
const { itemCatalog } = require("../../services/loot/lootStats");
const { serverContext, lootOfGuild, serverOfInteraction } = require("../../services/loot/lootServer");
const { annotatedCharacters } = require("../../services/characters/characterInfo");
const { myCharacters } = require("../../services/characters/userCharacters");
const { webUrl, lookupReply, respondChoices, focusedName, discordTime, plural, clip } = require("../../utils/discord/botLookup");
const { addVersionOption, versionOfCommand, versionNote } = require("../../services/events/commandVersion");
const { eventVersion, charactersOfVersion } = require("../../services/characters/characterVersions");
const { LEGACY_VERSION } = require("../../config/gameVersions");

/** The awards of one game version only: the version of the raid they were looted in (#743). */
function awardsOfVersion(items, versionId) {
    const ctx = { eventCache: new Map() };
    return (items || []).filter((it) => eventVersion(ctx, it.eventId) === versionId);
}

/**
 * The loot of the server the command was used on (#919): loot of another
 * server never shows, not even as a suggestion. `of(rows)` filters any list.
 */
function serverLoot(interaction) {
    const ctx = serverContext();
    const guildId = serverOfInteraction(interaction, ctx);
    return { all: () => lootOfGuild(listAll(), guildId, ctx), of: (rows) => lootOfGuild(rows, guildId, ctx) };
}

/** The item catalogue of one game version: only its awards, an item without one drops out. */
function catalogOfVersion(versionId, rows) {
    return itemCatalog(rows)
        .map((item) => {
            const awards = (item.awards || []).filter((a) => (a.versionId || LEGACY_VERSION) === versionId);
            return awards.length === (item.awards || []).length ? item : { ...item, awards, count: awards.length, lastAwardedAt: Math.max(0, ...awards.map((a) => a.awardedAt || 0)) };
        })
        .filter((item) => (item.awards || []).length > 0 || !Array.isArray(item.awards));
}

/** How many awards a reply lists — the web page has the rest. */
const MAX_ROWS = 6;

const itemLabel = (it) => it.itemName || `Item ${it.itemId}`;

/** "Grund · Datum" of one award, whatever is known of it. */
function awardMeta(it) {
    return [it.reasonLabel, discordTime(it.awardedAt)].filter(Boolean).join(" · ");
}

/** "8× BiS · 3× Offspec" — the reasons of a set of awards, strongest bucket first. */
function reasonLine(items) {
    const counts = new Map();
    for (const it of items) {
        const label = it.reasonLabel || "Sonstiges";
        counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => `${n}× ${label}`).join(" · ");
}

/** The newest awards of some characters, one line each. */
function itemLines(items, { withCharacter = false } = {}) {
    return items.slice(0, MAX_ROWS).map((it) => {
        const who = withCharacter ? ` → ${it.character}` : "";
        const meta = awardMeta(it);
        return `**${clip(itemLabel(it), 60)}**${who}${meta ? ` · ${meta}` : ""}`;
    }).join("\n");
}

const charUrl = (name) => webUrl(`/history/char?name=${encodeURIComponent(name)}`);

async function lootForMe(interaction, versionId) {
    const loot = serverLoot(interaction);
    // Strictly one version (#741): only the characters that play it, names and links alike.
    const chars = charactersOfVersion(myCharacters(interaction.user.id), versionId, { itemsOf: listByCharacter, assigned: true });
    if (!chars.length) {
        return lookupReply(interaction, {
            footer: { text: versionNote(versionId) },
            title: "Dein Loot",
            description: "Dir ist noch kein Charakter zugeordnet. Trag ihn in deinem Profil ein (`/profil`) — bis dahin hilft `/loot raider`.",
        }, [{ label: "Im Web öffnen", url: webUrl("/history") }]);
    }
    const items = awardsOfVersion(loot.of(chars.flatMap((c) => listByCharacter(c.character))), versionId)
        .sort((a, b) => (b.awardedAt || 0) - (a.awardedAt || 0));
    const names = chars.map((c) => c.character).join(", ");
    if (!items.length) {
        return lookupReply(interaction, {
            footer: { text: versionNote(versionId) },
            title: "Dein Loot",
            description: `**0 Items** · ${names}\nNoch nichts vergeben.`,
        }, [{ label: "Im Web öffnen", url: charUrl(chars[0].character) }]);
    }
    const multiple = chars.length > 1;
    return lookupReply(interaction, {
        footer: { text: versionNote(versionId) },
        title: "Dein Loot",
        description: `**${plural(items.length, "Item", "Items")}** · ${names}\n${reasonLine(items)}`,
        fields: [{ name: "Zuletzt", value: itemLines(items, { withCharacter: multiple }) }],
    }, chars.slice(0, 5).map((c) => ({ label: multiple ? c.character : "Im Web öffnen", url: charUrl(c.character) })));
}

/** An item of the loot catalog by the autocomplete value (its id) or by a typed name. */
function findItem(value, versionId, rows) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const catalog = catalogOfVersion(versionId, rows);
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) {
        const byId = catalog.find((i) => i.itemId === id);
        if (byId) return byId;
    }
    const lower = raw.toLowerCase();
    return catalog.find((i) => (i.itemName || "").toLowerCase() === lower)
        || catalog.find((i) => (i.itemName || "").toLowerCase().includes(lower))
        || null;
}

async function lootForItem(interaction, versionId) {
    const value = interaction.options.getString("item");
    const item = findItem(value, versionId, serverLoot(interaction).all());
    const link = [{ label: "Im Web öffnen", url: webUrl("/history?tab=items") }];
    if (!item) {
        return lookupReply(interaction, {
            footer: { text: versionNote(versionId) },
            title: "Item nicht gefunden",
            description: `„${clip(value, 100)}“ wurde noch nie vergeben.`,
        }, link);
    }
    const awards = item.awards.map((a) => ({ ...a, itemName: item.itemName, itemId: item.itemId }));
    return lookupReply(interaction, {
        footer: { text: versionNote(versionId) },
        title: itemLabel(item),
        url: item.itemLink || undefined,
        description: `**${item.count}× vergeben**${item.lastAwardedAt ? ` · zuletzt ${discordTime(item.lastAwardedAt)}` : ""}${item.boss ? `\n${item.boss}` : ""}`,
        fields: [{
            name: "An",
            value: awards.slice(0, MAX_ROWS).map((a) => `**${a.character}**${awardMeta(a) ? ` · ${awardMeta(a)}` : ""}`).join("\n"),
        }],
    }, link);
}

async function lootForRaider(interaction, versionId) {
    const name = String(interaction.options.getString("name") || "").trim();
    const items = awardsOfVersion(serverLoot(interaction).of(listByCharacter(name)), versionId);
    if (!items.length) {
        return lookupReply(interaction, {
            footer: { text: versionNote(versionId) },
            title: clip(name || "Raider", 100),
            description: "Kein Loot gefunden.",
        }, [{ label: "Im Web öffnen", url: webUrl("/history?tab=reasons") }]);
    }
    const character = items[0].character || name;
    return lookupReply(interaction, {
        footer: { text: versionNote(versionId) },
        title: character,
        description: `**${plural(items.length, "Item", "Items")}**\n${reasonLine(items)}`,
        fields: [{ name: "Zuletzt", value: itemLines(items) }],
    }, [{ label: "Im Web öffnen", url: charUrl(character) }]);
}

const HANDLERS = { ich: lootForMe, item: lootForItem, raider: lootForRaider };

module.exports = {
    name: "loot",
    description: "Loot nachschlagen: dein Loot, wer ein Item bekam, was ein Raider bekam.",
    group: "loot",
    defaultAccess: "everyone",
    data: new SlashCommandBuilder()
        .setName("loot")
        .setDescription("Loot nachschlagen")
        .addSubcommand((s) => addVersionOption(s.setName("ich").setDescription("Dein Loot (über deine zugeordneten Charaktere)")))
        .addSubcommand((s) => addVersionOption(s.setName("item").setDescription("Wer ein Item wann bekommen hat")
            .addStringOption((o) => o.setName("item").setDescription("Item").setRequired(true).setAutocomplete(true))))
        .addSubcommand((s) => addVersionOption(s.setName("raider").setDescription("Was ein Raider bekommen hat")
            .addStringOption((o) => o.setName("name").setDescription("Charaktername").setRequired(true).setAutocomplete(true)))),
    MAX_ROWS,
    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const handler = HANDLERS[sub] || lootForMe;
        return handler(interaction, versionOfCommand(interaction).versionId);
    },
    async autocomplete(interaction) {
        const rows = serverLoot(interaction).all();
        if (focusedName(interaction) === "item") {
            return respondChoices(interaction, catalogOfVersion(versionOfCommand(interaction).versionId, rows).map((i) => ({ name: itemLabel(i), value: String(i.itemId) })));
        }
        const versionId = versionOfCommand(interaction).versionId;
        return respondChoices(interaction, charactersOfVersion(annotatedCharacters({ rows }), versionId).map((c) => ({ name: c.character, value: c.character })));
    },
};
