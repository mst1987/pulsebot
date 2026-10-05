// The Discord side of absences and attendances (services/signups/availability.js):
// the panel a raid category's channel carries, the modals, the raid picker and
// the list of one's own entries. Pure builders plus the short-lived picker
// sessions; commands/signup/availability.js wires them to the interactions.
// Every builder takes the language (utils/i18n/botText.js): the panel the
// server's, everything else the reader's (services/discord/botLanguage.js).
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
const { tr, serviceText, specLabel, dateLocale } = require("../i18n/botText");
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

/** The three buttons of the panel (and of /availability). Shorter than the modals' titles they open. */
function panelButtons(categoryId = "", lang = "de") {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(panelId("a", categoryId)).setLabel(tr(lang, "Mark absent")).setEmoji("🏖️").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(panelId("p", categoryId)).setLabel(tr(lang, "Mark attending")).setEmoji("✅").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(panelId("l", categoryId)).setLabel(tr(lang, "My entries")).setEmoji("📋").setStyle(ButtonStyle.Secondary),
    );
}

/**
 * A category's name as the panel writes it: without the decoration a server
 * puts in front ("╭・ TBC Montag" → "TBC Montag"); the name itself when it is
 * nothing but decoration.
 */
function plainCategoryName(name) {
    const raw = str(name);
    return raw.replace(/^[^\p{L}\p{N}]+/u, "").trim() || raw;
}

/**
 * The panel message a raid category's channel carries — in the server
 * language. One sentence, the two kinds of entry side by side as inline
 * fields, the DM note in the footer (design A of the panel canvas, Okt 2026:
 * three paragraphs that named the category three times were too much to read).
 */
function panelPayload({ categoryId = "", categoryName = "", lang = "de" } = {}) {
    const category = plainCategoryName(categoryName);
    const vars = { category };
    return {
        content: "",
        embeds: [buildEmbed({
            title: category ? tr(lang, "Absence & attendance · {category}", vars) : tr(lang, "Absence & attendance"),
            description: category
                ? tr(lang, "Enter a period – the bot signs you off or up for every **{category}** raid in it.", vars)
                : tr(lang, "Enter a period – the bot signs you off or up for every raid in it."),
            fields: [
                { name: tr(lang, "🏖️ Away"), value: tr(lang, "Signed off from every raid in the period – also from ones created later"), inline: true },
                { name: tr(lang, "✅ There for sure"), value: tr(lang, "Signed up with your character as *Signed up*"), inline: true },
            ],
            footer: tr(lang, "One DM per raid · your own signup stays yours to change"),
            color: COLOR_PANEL,
        })],
        components: [panelButtons(categoryId, lang)],
    };
}

function dateInput(id, label, placeholder, required = true) {
    return new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId(id).setLabel(label).setPlaceholder(placeholder)
        .setStyle(TextInputStyle.Short).setMaxLength(10).setRequired(required));
}

/** The modal asking for the period (and the absence's reason). */
function periodModal(kind, categoryId = "", lang = "de") {
    const absence = kind === "absence";
    const modal = new ModalBuilder()
        .setCustomId(panelId(absence ? "ma" : "mp", categoryId))
        .setTitle(absence ? tr(lang, "Enter absence") : tr(lang, "Enter attendance"))
        .addComponents(
            dateInput("from", tr(lang, "From (day)"), tr(lang, "e.g. 24.10. or 24.10.2026")),
            dateInput("to", tr(lang, "To (day, empty = the same day)"), tr(lang, "e.g. 31.10."), false),
        );
    if (absence) {
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId("reason").setLabel(tr(lang, "Reason (optional, the raid lead sees it)")).setPlaceholder(tr(lang, "e.g. holiday, work"))
            .setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(false)));
    }
    return modal;
}

function versionName(versionId) {
    const v = VERSIONS.find((x) => x.id === versionId);
    return v ? v.label : versionId;
}

function specName(key, lang = "de") {
    return specLabel(lang, profiles.specInfo(key), key);
}

/** Every character · spec of the profile as select options (the profile's order), at most 25. */
function characterOptions(profile, versions = null, lang = "de") {
    const out = [];
    for (const c of (profile && profile.characters) || []) {
        if (versions && !versions.includes(c.versionId)) continue;
        for (const s of c.specs || []) {
            if (s.gear === "none") continue;
            out.push({ character: c.name, key: c.key, spec: s.key, versionId: c.versionId, label: `${c.name} · ${specName(s.key, lang)}` });
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

/** "Wed 24 Oct, 19:30" / "Mi. 24. Okt., 19:30" in server time — select options render no Discord timestamps. */
function raidWhen(startTime, lang = "de") {
    return DateTime.fromSeconds(Number(startTime) || 0, { zone: TIMEZONE }).setLocale(dateLocale(lang)).toFormat("ccc d LLL, HH:mm");
}

function dayText(day, lang = "de") {
    const dt = DateTime.fromISO(str(day), { zone: TIMEZONE });
    return dt.isValid ? dt.setLocale(dateLocale(lang)).toFormat("ccc d LLL yyyy") : str(day);
}

function periodLabel(from, to, lang = "de") {
    return from === to ? dayText(from, lang) : `${dayText(from, lang)} – ${dayText(to, lang)}`;
}

/**
 * The picker after the modal: the period, for an attendance the character ·
 * spec select, the raids of the period (all picked at first) and Save.
 */
function pickerPayload(token, session, raids, { profile, versions = null, notice = "", lang = "de" } = {}) {
    const absence = session.kind === "absence";
    const selected = session.selected || raids.map((e) => e.id);
    const counts = { picked: selected.length, total: raids.length };
    const lines = [`**${periodLabel(session.from, session.to, lang)}**`];
    if (absence && session.comment) lines.push(tr(lang, "Reason: {reason}", { reason: session.comment }));
    if (!absence && session.character) {
        lines.push(tr(lang, "Character: **{character}** · {spec} ({version})", { character: session.character, spec: specName(session.spec, lang), version: versionName(session.versionId) }));
    }
    lines.push("");
    if (raids.length) {
        lines.push(absence
            ? tr(lang, "Pick the raids to sign off from ({picked} of {total}).", counts)
            : tr(lang, "Pick the raids to sign up for ({picked} of {total}).", counts));
    } else {
        lines.push(tr(lang, "No raid in this period yet."));
    }
    lines.push(absence
        ? tr(lang, "Raids created later in this period sign you off automatically.")
        : tr(lang, "Raids created later in this period sign you up automatically."));
    if (notice) lines.push("", serviceText(lang, notice));
    const rows = [];
    if (!absence) {
        const options = characterOptions(profile, versions, lang);
        if (options.length) {
            rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
                .setCustomId(pickId(token, "c"))
                .setPlaceholder(tr(lang, "Character · spec"))
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
            .setPlaceholder(tr(lang, "No raid picked – only later ones"))
            .setMinValues(0)
            .setMaxValues(shown.length)
            .addOptions(shown.map((e) => ({
                label: str(e.title || "Raid").slice(0, 100),
                value: e.id,
                description: raidWhen(e.startTime, lang),
                default: selected.includes(e.id),
            })))));
    }
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(pickId(token, "save"))
            .setLabel(absence ? tr(lang, "Save absence") : tr(lang, "Save attendance"))
            .setStyle(absence ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId(pickId(token, "x")).setLabel(tr(lang, "Cancel")).setStyle(ButtonStyle.Secondary),
    ));
    return {
        content: "",
        embeds: [buildEmbed({
            title: absence ? tr(lang, "Enter absence") : tr(lang, "Enter attendance"),
            description: lines.join("\n"), color: absence ? COLOR_ABSENCE : COLOR_PRESENCE,
        })],
        components: rows,
    };
}

/** One line of an entry in the list. */
function entryLine(entry, lang = "de") {
    const period = periodLabel(entry.from, entry.to, lang);
    if (entry.kind === "absence") return `🏖️ **${tr(lang, "Away")}** · ${period}${entry.comment ? ` · ${entry.comment}` : ""}`;
    return `✅ **${tr(lang, "There")}** · ${period} · ${entry.character} · ${specName(entry.spec, lang)}`;
}

/** "My entries": the raider's entries that are not over yet, with a select to delete one. */
function listPayload(entries, { categoryId = "", notice = "", lang = "de" } = {}) {
    const lines = entries.length ? entries.map((e) => entryLine(e, lang)) : [tr(lang, "No absence or attendance entered.")];
    if (entries.length) lines.push("", tr(lang, "Deleting an entry stops it – the signups it made stay as they are."));
    if (notice) lines.push("", serviceText(lang, notice));
    const rows = [];
    if (entries.length) {
        rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(`${PREFIX}:del:${categoryId}`)
            .setPlaceholder(tr(lang, "Delete an entry …"))
            .addOptions(entries.slice(0, MAX_OPTIONS).map((e) => {
                const period = periodLabel(e.from, e.to, lang);
                return {
                    label: (e.kind === "absence" ? tr(lang, "Away {period}", { period }) : tr(lang, "There {period}", { period })).slice(0, 100),
                    value: e.id,
                    description: (e.kind === "absence" ? e.comment || tr(lang, "Absence") : `${e.character} · ${specName(e.spec, lang)}`).slice(0, 100),
                };
            }))));
    }
    rows.push(panelButtons(categoryId, lang));
    return {
        content: "",
        embeds: [buildEmbed({ title: tr(lang, "My absences & attendances"), description: lines.join("\n"), color: COLOR_PANEL })],
        components: rows,
    };
}

/** The answer after saving: the same summary the DM carries. */
function savedPayload(summary, { kind, dm, lang = "de" }) {
    const lines = [summary.description];
    if (dm === false) lines.push("", tr(lang, "⚠️ I could not send you a DM – are your DMs closed for this server?"));
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
