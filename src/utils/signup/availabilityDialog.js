// The Discord side of absences and attendances (services/signups/availability.js):
// the panel a raid category's channel carries, the modals, the raid picker and
// the list of one's own entries. Pure builders plus the short-lived picker
// sessions; commands/signup/availability.js wires them to the interactions.
//
// customIds (all `availability:…`, so the slash command's module answers them):
//   availability:a:<categoryId>   "Enter absence"    → modal availability:ma:<categoryId>
//   availability:p:<categoryId>   "Enter attendance" → modal availability:mp:<categoryId>
//   availability:l:<categoryId>   "My entries"       → the list with a delete select availability:del
//   availability:<token>:c | :r   picker selects (character · spec, raids) — redraw
//   availability:<token>:save     save the entry (applies it, DM)
//   availability:<token>:x        cancel
// An empty categoryId (the /availability command) means every raid category.
// The picks live in memory under the token for 30 minutes, only for the member
// who started — a modal cannot carry them and a customId has 100 characters.
const crypto = require("crypto");
const { DateTime } = require("luxon");
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const profiles = require("../../stores/raiderProfileStore");
const { VERSIONS } = require("../../config/gameVersions");
const { TIMEZONE } = require("../../config/timezone");
const { toEnglish } = require("./botEnglish");
const { buildEmbed } = require("../discord/reply");

const PREFIX = "availability";
const SESSION_TTL = 30 * 60 * 1000;
const MAX_OPTIONS = 25;
const COLOR_ABSENCE = 0xef4444;
const COLOR_PRESENCE = 0x22c55e;
const COLOR_PANEL = 0x38bdf8;

const sessions = new Map();

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

function createSession(userId, picks, now = Date.now()) {
    for (const [token, s] of sessions) if (now - s.at > SESSION_TTL) sessions.delete(token);
    let token;
    do token = crypto.randomBytes(4).toString("hex"); while (sessions.has(token));
    sessions.set(token, { ...picks, userId: String(userId), selected: null, at: now });
    return token;
}

function getSession(token, userId, now = Date.now()) {
    const s = sessions.get(String(token || ""));
    if (!s || s.userId !== String(userId) || now - s.at > SESSION_TTL) return null;
    s.at = now;
    return s;
}

function endSession(token) {
    sessions.delete(String(token || ""));
}

/** `{ action, categoryId }` of a panel id, or `{ token, action }` of a picker id. */
function parseId(customId) {
    const [, a = "", b = ""] = String(customId || "").split(":");
    if (/^[a-f0-9]{8}$/.test(a)) return { token: a, action: b, categoryId: "" };
    return { token: "", action: a, categoryId: b };
}

const panelId = (action, categoryId = "") => `${PREFIX}:${action}:${categoryId}`;
const pickId = (token, action) => `${PREFIX}:${token}:${action}`;

/** The three buttons of the panel (and of /availability). */
function panelButtons(categoryId = "") {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(panelId("a", categoryId)).setLabel("Enter absence").setEmoji("🏖️").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(panelId("p", categoryId)).setLabel("Enter attendance").setEmoji("✅").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(panelId("l", categoryId)).setLabel("My entries").setEmoji("📋").setStyle(ButtonStyle.Secondary),
    );
}

/** The panel message a raid category's channel carries. */
function panelPayload({ categoryId = "", categoryName = "" } = {}) {
    const raids = categoryName ? `**${categoryName}** raid` : "raid";
    const description = [
        `**Away for a while?** Enter your absence and you are signed off from every ${raids} in that period – also from raids created later.`,
        "",
        `**There for sure?** Enter your attendance with a character and you are signed up for every ${raids} in that period as *Signed up*.`,
        "",
        "You pick the raids yourself, and you get a DM for every raid the bot signs you up or off for. Your own signup always stays yours to change.",
    ].join("\n");
    return {
        content: "",
        embeds: [buildEmbed({ title: categoryName ? `Absence & attendance · ${categoryName}` : "Absence & attendance", description, color: COLOR_PANEL })],
        components: [panelButtons(categoryId)],
    };
}

function dateInput(id, label, placeholder, required = true) {
    return new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId(id).setLabel(label).setPlaceholder(placeholder)
        .setStyle(TextInputStyle.Short).setMaxLength(10).setRequired(required));
}

/** The modal asking for the period (and the absence's reason). */
function periodModal(kind, categoryId = "") {
    const absence = kind === "absence";
    const modal = new ModalBuilder()
        .setCustomId(panelId(absence ? "ma" : "mp", categoryId))
        .setTitle(absence ? "Enter absence" : "Enter attendance")
        .addComponents(
            dateInput("from", "From (day)", "e.g. 24.10. or 24.10.2026"),
            dateInput("to", "To (day, empty = the same day)", "e.g. 31.10.", false),
        );
    if (absence) {
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId("reason").setLabel("Reason (optional, the raid lead sees it)").setPlaceholder("e.g. holiday, work")
            .setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(false)));
    }
    return modal;
}

function versionName(versionId) {
    const v = VERSIONS.find((x) => x.id === versionId);
    return v ? v.label : versionId;
}

function specName(key) {
    const info = profiles.specInfo(key);
    return (info && (info.labelEn || info.label)) || key;
}

/** Every character · spec of the profile as select options (the profile's order), at most 25. */
function characterOptions(profile, versions = null) {
    const out = [];
    for (const c of (profile && profile.characters) || []) {
        if (versions && !versions.includes(c.versionId)) continue;
        for (const s of c.specs || []) {
            if (s.gear === "none") continue;
            out.push({ character: c.name, key: c.key, spec: s.key, versionId: c.versionId, label: `${c.name} · ${specName(s.key)}` });
        }
    }
    return out.slice(0, MAX_OPTIONS);
}

/** The attendance's starting pick: the raider's first character of the version, its first usable spec. */
function defaultCharacter(profile, versionId, versions = null) {
    const options = characterOptions(profile, versions);
    const first = profiles.firstCharacter(profile, "", { preferVersion: versionId });
    return (first && options.find((o) => o.key === first.key)) || options[0] || null;
}

/** "Wed 24 Oct, 19:30" in server time — select options render no Discord timestamps. */
function raidWhen(startTime) {
    return DateTime.fromSeconds(Number(startTime) || 0, { zone: TIMEZONE }).setLocale("en").toFormat("ccc d LLL, HH:mm");
}

function dayText(day) {
    const dt = DateTime.fromISO(str(day), { zone: TIMEZONE });
    return dt.isValid ? dt.setLocale("en").toFormat("ccc d LLL yyyy") : str(day);
}

function periodLabel(from, to) {
    return from === to ? dayText(from) : `${dayText(from)} – ${dayText(to)}`;
}

/**
 * The picker after the modal: the period, for an attendance the character ·
 * spec select, the raids of the period (all picked at first) and Save.
 */
function pickerPayload(token, session, raids, { profile, versions = null, notice = "" } = {}) {
    const absence = session.kind === "absence";
    const selected = session.selected || raids.map((e) => e.id);
    const lines = [`**${periodLabel(session.from, session.to)}**`];
    if (absence && session.comment) lines.push(`Reason: ${session.comment}`);
    if (!absence && session.character) lines.push(`Character: **${session.character}** · ${specName(session.spec)} (${versionName(session.versionId)})`);
    lines.push("");
    if (raids.length) {
        lines.push(absence
            ? `Pick the raids to sign off from (${selected.length} of ${raids.length}).`
            : `Pick the raids to sign up for (${selected.length} of ${raids.length}).`);
    } else {
        lines.push("No raid in this period yet.");
    }
    lines.push(absence
        ? "Raids created later in this period sign you off automatically."
        : "Raids created later in this period sign you up automatically.");
    if (notice) lines.push("", toEnglish(notice));
    const rows = [];
    if (!absence) {
        const options = characterOptions(profile, versions);
        if (options.length) {
            rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
                .setCustomId(pickId(token, "c"))
                .setPlaceholder("Character · spec")
                .addOptions(options.map((o) => ({
                    label: o.label.slice(0, 100),
                    value: `${o.key}|${o.spec}`.slice(0, 100),
                    description: versionName(o.versionId).slice(0, 100),
                    default: o.key === session.characterKey && o.spec === session.spec,
                })))));
        }
    }
    if (raids.length) {
        const shown = raids.slice(0, MAX_OPTIONS);
        rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(pickId(token, "r"))
            .setPlaceholder("No raid picked – only later ones")
            .setMinValues(0)
            .setMaxValues(shown.length)
            .addOptions(shown.map((e) => ({
                label: str(e.title || "Raid").slice(0, 100),
                value: e.id,
                description: raidWhen(e.startTime),
                default: selected.includes(e.id),
            })))));
    }
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(pickId(token, "save")).setLabel(absence ? "Save absence" : "Save attendance").setStyle(absence ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId(pickId(token, "x")).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ));
    return {
        content: "",
        embeds: [buildEmbed({ title: absence ? "Enter absence" : "Enter attendance", description: lines.join("\n"), color: absence ? COLOR_ABSENCE : COLOR_PRESENCE })],
        components: rows,
    };
}

/** One line of an entry in the list. */
function entryLine(entry) {
    const period = periodLabel(entry.from, entry.to);
    if (entry.kind === "absence") return `🏖️ **Away** · ${period}${entry.comment ? ` · ${entry.comment}` : ""}`;
    return `✅ **There** · ${period} · ${entry.character} · ${specName(entry.spec)}`;
}

/** "My entries": the raider's entries that are not over yet, with a select to delete one. */
function listPayload(entries, { categoryId = "", notice = "" } = {}) {
    const lines = entries.length ? entries.map(entryLine) : ["No absence or attendance entered."];
    if (entries.length) lines.push("", "Deleting an entry stops it – the signups it made stay as they are.");
    if (notice) lines.push("", toEnglish(notice));
    const rows = [];
    if (entries.length) {
        rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(`${PREFIX}:del:${categoryId}`)
            .setPlaceholder("Delete an entry …")
            .addOptions(entries.slice(0, MAX_OPTIONS).map((e) => ({
                label: (e.kind === "absence" ? `Away ${periodLabel(e.from, e.to)}` : `There ${periodLabel(e.from, e.to)}`).slice(0, 100),
                value: e.id,
                description: (e.kind === "absence" ? e.comment || "Absence" : `${e.character} · ${specName(e.spec)}`).slice(0, 100),
            })))));
    }
    rows.push(panelButtons(categoryId));
    return {
        content: "",
        embeds: [buildEmbed({ title: "My absences & attendances", description: lines.join("\n"), color: COLOR_PANEL })],
        components: rows,
    };
}

/** The answer after saving: the same summary the DM carries. */
function savedPayload(summary, { kind, dm }) {
    const lines = [summary.description];
    if (dm === false) lines.push("", "⚠️ I could not send you a DM – are your DMs closed for this server?");
    return {
        content: "",
        embeds: [buildEmbed({ title: summary.title, description: lines.join("\n"), color: kind === "absence" ? COLOR_ABSENCE : COLOR_PRESENCE })],
        components: [],
    };
}

module.exports = {
    PREFIX, createSession, getSession, endSession, parseId, panelId, pickId,
    panelButtons, panelPayload, periodModal, characterOptions, defaultCharacter, pickerPayload, listPayload, savedPayload,
    entryLine, periodLabel, raidWhen,
};
