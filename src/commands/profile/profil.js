// /profil — the raider's own profile in short (#255, English like every
// raider-facing bot text), with the one change that
// is worth a button: "kann Offtank" / "kann heilen". Everything else is a link
// into the web page, where there is room for it.
//
// The buttons carry the switch in their customId ("profil:tank"), so the same
// file answers the slash command and the clicks (see bot.js' customId routing).
// The switches belong to a character; the buttons act on the main — the other
// characters are switched on the web page.
const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const profiles = require("../../web/raiderProfileStore");
const { publicBaseUrl } = require("../../utils/publicUrl");

const GEAR_LABELS = { none: "no gear", usable: "usable", ready: "raid ready" };
const DAY_LABELS = { mo: "Mon", di: "Tue", mi: "Wed", do: "Thu", fr: "Fri", sa: "Sat", so: "Sun" };
const TOGGLES = { tank: "canOfftank", heal: "canHeal" };

function profileUrl() {
    return `${publicBaseUrl()}/profile`;
}

/** The embed text of a profile. Pure. */
function summaryLines(profile) {
    const lines = [];
    if (!profile.characters.length) {
        lines.push("No character yet.");
    }
    for (const c of profile.characters) {
        const specs = c.specs
            .map((s) => {
                const info = profiles.specInfo(s.key);
                return `${(info && (info.labelEn || info.label)) || s.key} (${GEAR_LABELS[s.gear] || s.gear})`;
            })
            .join(", ");
        const roles = profiles.characterRoles(profile, c);
        const also = [roles.canOfftank ? "off-tank" : "", roles.canHeal ? "heal" : ""].filter(Boolean).join(", ");
        lines.push(`**${c.name}**${c.main ? " · Main" : ""} — ${specs || "no specs"}${also ? ` · can ${also}` : ""}`);
    }
    lines.push("");
    lines.push(`Available: ${profile.availability.length ? profile.availability.map((d) => DAY_LABELS[d]).join(" · ") : "not given"}`);
    return lines;
}

function buttons(profile) {
    const main = profiles.mainCharacter(profile);
    const roles = profiles.characterRoles(profile, main);
    const link = new ButtonBuilder().setLabel("Open profile").setStyle(ButtonStyle.Link).setURL(profileUrl());
    const row = new ActionRowBuilder();
    // only the switches the main's class can use at all (a mage gets neither)
    if (main && roles.possible.canOfftank) {
        row.addComponents(new ButtonBuilder()
            .setCustomId("profil:tank")
            .setLabel(`${main.name}: ${roles.canOfftank ? "no off-tank" : "can off-tank"}`)
            .setStyle(roles.canOfftank ? ButtonStyle.Secondary : ButtonStyle.Primary));
    }
    if (main && roles.possible.canHeal) {
        row.addComponents(new ButtonBuilder()
            .setCustomId("profil:heal")
            .setLabel(`${main.name}: ${roles.canHeal ? "no healing" : "can heal"}`)
            .setStyle(roles.canHeal ? ButtonStyle.Secondary : ButtonStyle.Primary));
    }
    return row.addComponents(link);
}

function message(profile) {
    const embed = new EmbedBuilder()
        .setTitle("My profile")
        .setDescription(summaryLines(profile).join("\n"))
        .setColor(0x38bdf8);
    return { embeds: [embed], components: [buttons(profile)] };
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
        .setDescription("Zeigt dein Raider-Profil kurz an, mit Link ins Web"),
    summaryLines,
    async execute(interaction) {
        const userId = interaction.user.id;
        const name = interaction.user.globalName || interaction.user.username || "";
        const toggle = TOGGLES[String(interaction.customId || "").split(":")[1] || ""];

        if (toggle && typeof interaction.isButton === "function" && interaction.isButton()) {
            const profile = profiles.getProfile(userId);
            const main = profiles.mainCharacter(profile);
            if (!main) return interaction.update(message(profile));
            const current = profiles.characterRoles(profile, main);
            if (!current.possible[toggle]) return interaction.update(message(profile));
            const saved = profiles.saveProfile(userId, { characters: [{ key: main.key, [toggle]: !current[toggle] }] }, { name });
            return interaction.update(message(saved));
        }

        return interaction.reply({ ...message(profiles.getProfile(userId)), flags: MessageFlags.Ephemeral });
    },
};
