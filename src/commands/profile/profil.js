// /profil — the raider's own profile in short (#255, English like every
// raider-facing bot text), with the one change that
// is worth a button: "kann Offtank" / "kann heilen". Everything else is a link
// into the web page, where there is room for it.
//
// The buttons carry the switch in their customId ("profil:tank"), so the same
// file answers the slash command and the clicks (see bot.js' customId routing).
const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const profiles = require("../../web/raiderProfileStore");
const { effectiveRoles } = require("../../web/profileView");
const { publicBaseUrl } = require("../../config/variables");

const GEAR_LABELS = { none: "no gear", usable: "usable", ready: "raid ready" };
const DAY_LABELS = { mo: "Mon", di: "Tue", mi: "Wed", do: "Thu", fr: "Fri", sa: "Sat", so: "Sun" };
const TOGGLES = { tank: "canOfftank", heal: "canHeal" };

function profileUrl() {
    return `${String(publicBaseUrl || "").replace(/\/+$/, "")}/profile`;
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
        lines.push(`**${c.name}**${c.main ? " · Main" : ""} — ${specs || "no specs"}`);
    }
    const roles = effectiveRoles(profile);
    lines.push("");
    lines.push(`Off-tank: ${roles.canOfftank ? "yes" : "no"} · Heal: ${roles.canHeal ? "yes" : "no"}`);
    lines.push(`Available: ${profile.availability.length ? profile.availability.map((d) => DAY_LABELS[d]).join(" · ") : "not given"}`);
    return lines;
}

function buttons(profile) {
    const roles = effectiveRoles(profile);
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("profil:tank")
            .setLabel(roles.canOfftank ? "No off-tank" : "Can off-tank")
            .setStyle(roles.canOfftank ? ButtonStyle.Secondary : ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("profil:heal")
            .setLabel(roles.canHeal ? "No healing" : "Can heal")
            .setStyle(roles.canHeal ? ButtonStyle.Secondary : ButtonStyle.Primary),
        new ButtonBuilder().setLabel("Open profile").setStyle(ButtonStyle.Link).setURL(profileUrl()),
    );
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
    summaryLines,
    async execute(interaction) {
        const userId = interaction.user.id;
        const name = interaction.user.globalName || interaction.user.username || "";
        const toggle = TOGGLES[String(interaction.customId || "").split(":")[1] || ""];

        if (toggle && typeof interaction.isButton === "function" && interaction.isButton()) {
            const current = effectiveRoles(profiles.getProfile(userId));
            const saved = profiles.saveProfile(userId, { [toggle]: !current[toggle] }, { name });
            return interaction.update(message(saved));
        }

        return interaction.reply({ ...message(profiles.getProfile(userId)), flags: MessageFlags.Ephemeral });
    },
};
