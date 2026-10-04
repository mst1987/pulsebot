// /profil — the raider's own profile in short (#255, in the raider's own
// language, services/discord/botLanguage.js), with the one change that
// is worth a button: "kann Offtank" / "kann heilen". Everything else is a link
// into the web page, where there is room for it.
//
// The buttons carry the switch in their customId ("profil:tank"), so the same
// file answers the slash command and the clicks (see bot.js' customId routing).
// The switches belong to a character; the buttons act on the raider's first
// character of the main game version (there is no "main", only the raider's
// order) — the other characters are switched on the web page.
const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const profiles = require("../../stores/raiderProfileStore");
const { mainVersionFor } = require("../../services/events/mainVersion");
const { publicBaseUrl } = require("../../utils/publicUrl");
const { langOfInteraction } = require("../../services/discord/botLanguage");
const { tr, specLabel } = require("../../utils/i18n/botText");

/** The character the buttons switch: the first of the main version, else the first at all. */
const firstOf = (profile) => profiles.firstCharacter(profile, "", { preferVersion: mainVersionFor() });

// English, translated with tr(lang, TABLE[key]).
const GEAR_LABELS = { none: "no gear", usable: "usable", ready: "raid ready" };
const DAY_LABELS = { mo: "Mon", di: "Tue", mi: "Wed", do: "Thu", fr: "Fri", sa: "Sat", so: "Sun" };
const TOGGLES = { tank: "canOfftank", heal: "canHeal" };

function profileUrl() {
    return `${publicBaseUrl()}/profile`;
}

/** The embed text of a profile, in the reader's language. Pure. */
function summaryLines(profile, lang = "de") {
    const lines = [];
    if (!profile.characters.length) {
        lines.push(tr(lang, "No character yet."));
    }
    for (const c of profile.characters) {
        const specs = c.specs
            .map((s) => `${specLabel(lang, profiles.specInfo(s.key), s.key)} (${GEAR_LABELS[s.gear] ? tr(lang, GEAR_LABELS[s.gear]) : s.gear})`)
            .join(", ");
        const roles = profiles.characterRoles(profile, c);
        const also = [roles.canOfftank ? tr(lang, "off-tank") : "", roles.canHeal ? tr(lang, "heal") : ""].filter(Boolean).join(", ");
        lines.push(`**${c.name}** — ${specs || tr(lang, "no specs")}${also ? ` · ${tr(lang, "can {roles}", { roles: also })}` : ""}`);
    }
    lines.push("");
    const days = profile.availability.length ? profile.availability.map((d) => (DAY_LABELS[d] ? tr(lang, DAY_LABELS[d]) : d)).join(" · ") : tr(lang, "not given");
    lines.push(tr(lang, "Available: {days}", { days }));
    return lines;
}

function buttons(profile, lang) {
    const main = firstOf(profile);
    const roles = profiles.characterRoles(profile, main);
    const link = new ButtonBuilder().setLabel(tr(lang, "Open profile")).setStyle(ButtonStyle.Link).setURL(profileUrl());
    const row = new ActionRowBuilder();
    // only the switches the character's class can use at all (a mage gets neither)
    if (main && roles.possible.canOfftank) {
        row.addComponents(new ButtonBuilder()
            .setCustomId("profil:tank")
            .setLabel(`${main.name}: ${roles.canOfftank ? tr(lang, "no off-tank") : tr(lang, "can off-tank")}`)
            .setStyle(roles.canOfftank ? ButtonStyle.Secondary : ButtonStyle.Primary));
    }
    if (main && roles.possible.canHeal) {
        row.addComponents(new ButtonBuilder()
            .setCustomId("profil:heal")
            .setLabel(`${main.name}: ${roles.canHeal ? tr(lang, "no healing") : tr(lang, "can heal")}`)
            .setStyle(roles.canHeal ? ButtonStyle.Secondary : ButtonStyle.Primary));
    }
    return row.addComponents(link);
}

function message(profile, lang) {
    const embed = new EmbedBuilder()
        .setTitle(tr(lang, "My profile"))
        .setDescription(summaryLines(profile, lang).join("\n"))
        .setColor(0x38bdf8);
    return { embeds: [embed], components: [buttons(profile, lang)] };
}

module.exports = {
    name: "profil",
    description: "Zeigt dein Raider-Profil kurz an, mit Link ins Web.",
    // Everyone's own profile — the buttons ("profil:tank") share this name and
    // therefore this access.
    group: "signup",
    defaultAccess: "everyone",
    data: new SlashCommandBuilder()
        .setName("profil")
        .setDescription("Shows your raider profile in short, with a link to the web")
        .setDescriptionLocalizations({ de: "Zeigt dein Raider-Profil kurz an, mit Link ins Web" }),
    summaryLines,
    async execute(interaction) {
        const userId = interaction.user.id;
        const name = interaction.user.globalName || interaction.user.username || "";
        const toggle = TOGGLES[String(interaction.customId || "").split(":")[1] || ""];
        const lang = langOfInteraction(interaction);

        if (toggle && typeof interaction.isButton === "function" && interaction.isButton()) {
            const profile = profiles.getProfile(userId);
            const main = firstOf(profile);
            if (!main) return interaction.update(message(profile, lang));
            const current = profiles.characterRoles(profile, main);
            if (!current.possible[toggle]) return interaction.update(message(profile, lang));
            const saved = profiles.saveProfile(userId, { characters: [{ key: main.key, [toggle]: !current[toggle] }] }, { name });
            return interaction.update(message(saved, lang));
        }

        return interaction.reply({ ...message(profiles.getProfile(userId), lang), flags: MessageFlags.Ephemeral });
    },
};
