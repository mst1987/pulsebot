// The orga links of the Orga-Zentrale, managed in Discord (the web edits the same
// list: Einstellungen -> Kategorien, apiRoutes/discord/orgaHub.js). All of it hangs off the
// component prefix `orga` (commands/event/orgaHubButton.js):
//
//   button  orga:links:<cat>              "Links ..." on the hub: an ephemeral card with
//                                         the current links and the controls below
//   button  orga:ladd:<cat>               "Link hinzufuegen": opens a modal (Name, Adresse, optional Emoji);
//   modal   orga:ladd:<cat>               its submit saves the link
//   select  orga:ledit:<cat>              "Link bearbeiten ...": opens the modal prefilled;
//   modal   orga:lsave:<cat>:<i>:<hash>   its submit replaces that link
//   select  orga:ldel:<cat>               "Link entfernen ...": removes the chosen link
//
// The order follows docs/known-issues.md (acknowledge first, check afterwards): the
// button and the delete select acknowledge, then check; a modal can only be the
// direct answer to a click, so the two buttons that open one show it at once and
// the orga check happens on its submit (deferUpdate first, a refusal replaces the
// card). The category id in a customId is untrusted: it must be a category whose hub
// is posted on this server. A link is addressed by its index plus a short hash of
// its content, so a card that went stale (another orga changed the list) never
// edits or deletes the wrong link. Every change goes through orgaHub.saveLinks,
// which redraws the hub at once.
const crypto = require("crypto");
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const { card } = require("../../utils/discord/card");
const { clip } = require("../../utils/discord/botLookup");
const store = require("../../stores/discord/orgaHubStore");
const orgaHub = require("./orgaHub");
const { categoryNameFor } = require("../signups/availabilityPanel");
const { plainCategoryName } = require("../../utils/signup/availabilityDialog");
const { NEW_RAID_PREFIX } = require("./orgaHubPanel");
const categoryOrga = require("../roster/categoryOrga");

const DENIED = "Dafür fehlt dir das Recht.";
const ACTIONS = { show: "links", add: "ladd", edit: "ledit", save: "lsave", del: "ldel" };
const LINK_ACTIONS = Object.values(ACTIONS);
/** A link button's address is limited to 512 characters by Discord. */
const URL_MAX = 512;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const id = (action, categoryId, ...rest) => [NEW_RAID_PREFIX, action, categoryId, ...rest].join(":");
const hashOf = (link) => crypto.createHash("sha1").update(`${link.label}\n${link.url}\n${link.emoji || ""}`).digest("hex").slice(0, 8);
/** Room for a custom emoji's text `<a:name:id>` (32 + 25 + 5). */
const EMOJI_MAX = 64;
const escapeMd = (s) => String(s || "").replace(/([\\*_~`|>[\]])/g, "\\$1");

/** `{ action, categoryId, index, hash }` of `orga:<action>:<categoryId>[:<index>:<hash>]`. */
function parseLinkId(customId) {
    const [, action = "", categoryId = "", index = "", hash = ""] = String(customId || "").split(":");
    return { action, categoryId, index: /^\d+$/.test(index) ? Number(index) : -1, hash };
}

/** The category's posted hub on this server, or null (the customId's category is untrusted). */
function hubOnServer(categoryId, guildId) {
    const hub = categoryId ? store.getHub(categoryId) : null;
    return hub && str(hub.guildId) === str(guildId) ? hub : null;
}

/** The link `index` of the category's list when it still is the one the card showed (`hash`), else null. */
function linkAt(categoryId, index, hash) {
    const link = store.getLinks(categoryId)[index];
    return link && hashOf(link) === hash ? link : null;
}

const errorCard = (title, text, ephemeral = false) => card({ kind: "error", title, text, ephemeral });
const gone = (ephemeral) => errorCard("Diese Orga-Zentrale gibt es nicht mehr.", "Poste sie im Web neu.", ephemeral);
const stale = (ephemeral) => errorCard("Die Links haben sich geändert.", "Öffne „Links …“ noch einmal.", ephemeral);

/** The ephemeral card: the links, add / edit / remove. `note` is a result line above them. */
function linksCard(categoryId, { config, note = "", kind = "info" } = {}) {
    const links = store.getLinks(categoryId);
    const name = plainCategoryName(categoryNameFor(categoryId, { config }));
    const lines = links.length
        ? links.map((l, i) => `${i + 1}. ${l.emoji ? `${l.emoji} ` : ""}**${escapeMd(l.label)}** · <${l.url}>`)
        : ["Noch keine Links. Sie erscheinen als Knöpfe unter „Raid anlegen“."];
    const full = links.length >= store.MAX_LINKS;
    const option = (l, i) => ({ label: clip(l.label, 100), value: `${i}:${hashOf(l)}`, description: clip(l.url, 100) });
    const parts = [];
    if (links.length) {
        parts.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(id(ACTIONS.edit, categoryId)).setPlaceholder("Link bearbeiten …").addOptions(links.map(option)),
        ));
        parts.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(id(ACTIONS.del, categoryId)).setPlaceholder("Link entfernen …").addOptions(links.map(option)),
        ));
    }
    return card({
        kind,
        kicker: name ? `Orga-Zentrale · ${name}` : "Orga-Zentrale",
        title: "Links der Orga-Zentrale",
        text: [note, ...lines].filter(Boolean).join("\n"),
        parts,
        buttons: [new ButtonBuilder().setCustomId(id(ACTIONS.add, categoryId)).setLabel("Link hinzufügen").setStyle(ButtonStyle.Primary).setDisabled(full)],
        note: full
            ? `Höchstens ${store.MAX_LINKS} Links – entferne zuerst einen, um einen neuen hinzuzufügen.`
            : `Bis zu ${store.MAX_LINKS} Links als Knöpfe in der Orga-Zentrale. Der Name darf ${store.LINK_LABEL_MAX} Zeichen lang sein, die Adresse muss mit https:// beginnen.`,
    });
}

/** The modal for a new link (`prefill` = an existing one, `index`/`hash` address it on submit). */
function linkModal(categoryId, { prefill = null, index = -1 } = {}) {
    const input = (customId, label, max, value, placeholder, required = true) => {
        const field = new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(TextInputStyle.Short)
            .setRequired(required).setMaxLength(max).setPlaceholder(placeholder);
        if (value) field.setValue(String(value).slice(0, max));
        return new ActionRowBuilder().addComponents(field);
    };
    return new ModalBuilder()
        .setCustomId(prefill ? id(ACTIONS.save, categoryId, String(index), hashOf(prefill)) : id(ACTIONS.add, categoryId))
        .setTitle(prefill ? "Link bearbeiten" : "Link hinzufügen")
        .addComponents(
            input("label", "Name (steht auf dem Knopf)", store.LINK_LABEL_MAX, prefill && prefill.label, "z. B. Warcraft-Logs-Gilde"),
            input("url", "Adresse (https://…)", URL_MAX, prefill && prefill.url, "https://"),
            input("emoji", "Emoji vor dem Namen (leer = keins)", EMOJI_MAX, prefill && prefill.emoji, "z. B. 📊", false),
        );
}

const typed = (interaction, field) => {
    try {
        return str(interaction.fields.getTextInputValue(field));
    } catch {
        return "";
    }
};

/** The link the modal was filled in with; `emoji` only when one was typed. */
function typedLink(interaction) {
    const link = { label: typed(interaction, "label"), url: typed(interaction, "url") };
    const emoji = typed(interaction, "emoji");
    return emoji ? { ...link, emoji } : link;
}

/** Save `list`, redraw the hub and answer with the card (the error line on top when it was refused). */
async function saveAndAnswer(interaction, categoryId, list, done) {
    const result = await orgaHub.saveLinks(categoryId, list);
    if (result.error) return interaction.editReply(linksCard(categoryId, { note: `⚠️ ${result.error}`, kind: "warn" }));
    return interaction.editReply(linksCard(categoryId, { note: done, kind: "ok" }));
}

/**
 * Every `orga:` customId of the links (see the head comment). Who may: the orga of the category - the
 * rule of "Raid anlegen" and of the web (services/roster/categoryOrga.js); `isCategoryOrga` replaces
 * it in a test.
 */
async function handleLinkAction(interaction, guildId, isCategoryOrga = categoryOrga.isCategoryOrgaById) {
    const { action, categoryId, index, hash } = parseLinkId(interaction.customId);
    const userId = str(interaction.user && interaction.user.id);
    const modalSubmit = typeof interaction.isModalSubmit === "function" && interaction.isModalSubmit();

    // The two clicks that open a modal answer with it at once; the orga check waits for its submit.
    if (!modalSubmit && action === ACTIONS.add) {
        if (!hubOnServer(categoryId, guildId)) return interaction.reply(gone(true));
        return interaction.showModal(linkModal(categoryId));
    }
    if (!modalSubmit && action === ACTIONS.edit) {
        const [i, h] = str(interaction.values && interaction.values[0]).split(":");
        const link = hubOnServer(categoryId, guildId) ? linkAt(categoryId, Number(i), h) : null;
        if (!link) return interaction.reply(stale(true));
        return interaction.showModal(linkModal(categoryId, { prefill: link, index: Number(i) }));
    }

    // Everything else: acknowledge first, then check (docs/known-issues.md).
    if (action === ACTIONS.show) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    else if (modalSubmit || action === ACTIONS.del) await interaction.deferUpdate();
    else return interaction.reply(card({ kind: "error", title: "Diese Aktion gibt es nicht.", ephemeral: true }));

    if (!hubOnServer(categoryId, guildId)) return interaction.editReply(gone());
    if (!(await isCategoryOrga(userId, categoryId, { guildId }))) return interaction.editReply(errorCard(DENIED));

    const links = store.getLinks(categoryId);
    if (action === ACTIONS.show) return interaction.editReply(linksCard(categoryId));

    if (action === ACTIONS.add) {
        const link = typedLink(interaction);
        return saveAndAnswer(interaction, categoryId, [...links, link], `Link „${escapeMd(link.label)}“ hinzugefügt.`);
    }
    if (action === ACTIONS.save) {
        const old = linkAt(categoryId, index, hash);
        if (!old) return interaction.editReply(linksCard(categoryId, { note: "⚠️ Die Links haben sich geändert – bitte noch einmal.", kind: "warn" }));
        const link = typedLink(interaction);
        return saveAndAnswer(interaction, categoryId, links.map((l, i) => (i === index ? link : l)), `Link „${escapeMd(link.label)}“ gespeichert.`);
    }
    // ACTIONS.del
    const [i, h] = str(interaction.values && interaction.values[0]).split(":");
    const victim = linkAt(categoryId, Number(i), h);
    if (!victim) return interaction.editReply(linksCard(categoryId, { note: "⚠️ Die Links haben sich geändert – bitte noch einmal.", kind: "warn" }));
    return saveAndAnswer(interaction, categoryId, links.filter((_, n) => n !== Number(i)), `Link „${escapeMd(victim.label)}“ entfernt.`);
}

module.exports = { handleLinkAction, linksCard, linkModal, parseLinkId, hashOf, LINK_ACTIONS, ACTIONS, DENIED };
