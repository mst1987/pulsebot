// The signup dialog in Discord (#258): an ephemeral message with the raid head,
// a character · spec select, a "kann auch" multi-select, the five status buttons
// and a comment button. Opened from the talk overview's select (`talk-signup`)
// and the event message's button (`event-signup:<eventId>`); every further step
// is a component of the same message and updates it in place.
//
// Nothing is kept in memory. What the member picked but has not saved yet rides
// along in the customIds of the message's components:
//
//   signup-pick:<eventId>:<field>:<state>     field k = class, s = character·spec, a = kann auch
//   signup-status:<eventId>:<code>:<state>    code s/t/l/b/a = signed/tentative/late/bench/absence
//   signup-comment:<eventId>:<state>          button and modal
//
// with <state> = <characterKey>:<specKey>:<roleMask> (mask letters t/h/m/r).
// Discord caps a customId at 100 characters; a state that would not fit is
// dropped and the handler falls back to the stored signup. Each step reads the
// event, the profile and the signup again and every save goes through
// signupService.submitSignup — a customId is a hint, never a permission.
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const { embedAccentColor } = require("../../config/variables");
const { publicBaseUrl } = require("../publicUrl");
const { rulesForEvent, versionOfEvent } = require("../../services/events/mainVersion");
const { rulesFor } = require("../../config/gameVersions");
const { ROLES } = require("../../config/gameVersions/classes");
const { tr, serviceText, specLabel: specLabelOf, classLabel: classLabelOf } = require("../i18n/botText");
const { langOfInteraction } = require("../../services/discord/botLanguage");
const { answerUpdate } = require("./signupReply");
const { listSignups, getSignup } = require("../../stores/signupStore");
const profiles = require("../../stores/raiderProfileStore");
const { allowsLastName, NAME_PART_MIN, NAME_PART_MAX, NAME_MAX } = require("./characterNames");
const {
    roleCounts, signupWindow, allowedStatuses, defaultCanAlso, wishPartnersSignedUp,
} = require("../../services/signups/signupService");

const PICK_PREFIX = "signup-pick";
const STATUS_PREFIX = "signup-status";
const COMMENT_PREFIX = "signup-comment";
const MAX_CUSTOM_ID = 100;
const MAX_OPTIONS = 25;

const STATUS_CODES = { signed: "s", tentative: "t", late: "l", bench: "b", absence: "a" };
const STATUS_BY_CODE = Object.fromEntries(Object.entries(STATUS_CODES).map(([k, v]) => [v, k]));
// What a raider reads, as a de/en pair (utils/i18n/botText.js has the language):
// STATUS_LABELS names the action (a button "Anmelden"), STATUS_STATE the state
// a signup is in ("Dabei"). A pair, not tr(): "Absence" means "Abwesenheit"
// elsewhere, here it is the button "Abmelden".
const STATUS_LABELS = { signed: "Sign up", tentative: "Tentative", late: "Late", bench: "Bench", absence: "Absence" };
const STATUS_LABELS_DE = { signed: "Anmelden", tentative: "Vielleicht", late: "Spät", bench: "Bank", absence: "Abmelden" };
const STATUS_STATE = { signed: "Signed up", tentative: "Tentative", late: "Late", bench: "Bench", absence: "Absence" };
const STATUS_STATE_DE = { signed: "Dabei", tentative: "Vielleicht", late: "Spät", bench: "Bank", absence: "Abgemeldet" };
const ROLE_CODES = { tank: "t", healer: "h", melee: "m", ranged: "r" };
// English sentences, translated with tr(lang, TABLE[key]).
const ALSO_LABELS = { tank: "Off-tank", healer: "Heal", melee: "Melee (off-spec)", ranged: "Ranged (off-spec)" };
const GEAR_LABELS = { none: "no gear", usable: "gear usable", ready: "gear raid ready" };
// The gear level of a spec in a select option's description (short).
const GEAR_TEXT = { ready: "raid ready", usable: "usable", none: "no gear" };

const pairOf = (lang, de, en, key) => (lang === "en" ? en[key] : de[key]) || en[key] || key;
/** The status as an action ("Anmelden" / "Sign up"). */
const statusLabel = (lang, status) => pairOf(lang, STATUS_LABELS_DE, STATUS_LABELS, status);
/** The status a signup is in ("Dabei" / "Signed up"). */
const statusState = (lang, status) => pairOf(lang, STATUS_STATE_DE, STATUS_STATE, status);
/** "raidbereit" / "raid ready" — "" for an unknown level. */
const gearText = (lang, gear) => (GEAR_TEXT[gear] ? tr(lang, GEAR_TEXT[gear]) : "");


/** "t", "hm" … for a role list; unknown roles are left out. */
function encodeRoles(roles) {
    return ROLES.filter((r) => (roles || []).includes(r)).map((r) => ROLE_CODES[r]).join("");
}

function decodeRoles(mask) {
    return ROLES.filter((r) => String(mask || "").includes(ROLE_CODES[r]));
}

/** `<characterKey>:<specKey>:<mask>` — the unsaved picks. */
function encodeState(state = {}) {
    return [String(state.character || ""), String(state.spec || ""), encodeRoles(state.canAlso)].join(":");
}

/** The picks back from the three trailing parts of a customId; null when there are none. */
function decodeState(parts) {
    if (!parts || parts.length < 3) return null;
    return { character: parts[0] || "", spec: parts[1] || "", canAlso: decodeRoles(parts[2]) };
}

/** customId with the state appended — without it when the whole id would be too long. */
function withState(head, state) {
    const id = `${head}:${encodeState(state)}`;
    return id.length <= MAX_CUSTOM_ID ? id : head.slice(0, MAX_CUSTOM_ID);
}

const pickId = (eventId, field, state) => withState(`${PICK_PREFIX}:${eventId}:${field}`, state);
const statusId = (eventId, status, state) => withState(`${STATUS_PREFIX}:${eventId}:${STATUS_CODES[status]}`, state);
const commentId = (eventId, state) => withState(`${COMMENT_PREFIX}:${eventId}`, state);

/** Reads `signup-pick:<eventId>:<field>:<state>`. */
function parsePickId(customId) {
    const [, eventId = "", field = "", ...rest] = String(customId || "").split(":");
    return { eventId, field, state: decodeState(rest) };
}

/** Reads `signup-status:<eventId>:<code>:<state>`. */
function parseStatusId(customId) {
    const [, eventId = "", code = "", ...rest] = String(customId || "").split(":");
    return { eventId, status: STATUS_BY_CODE[code] || "", state: decodeState(rest) };
}

/** Reads `signup-comment:<eventId>:<state>`. */
function parseCommentId(customId) {
    const [, eventId = "", ...rest] = String(customId || "").split(":");
    return { eventId, state: decodeState(rest) };
}

/**
 * The characters of a profile that can sign up (have at least one spec) — with
 * `versionId` only those of the event's game version (#543).
 */
function signableCharacters(profile, versionId = "") {
    return profiles.charactersOfVersion(profile, versionId).filter((c) => c.specs.length);
}

/** "WoW Forever" — the name of a version as a raider reads it. */
function versionLabel(versionId) {
    const rules = rulesFor(versionId);
    return (rules && rules.label) || String(versionId || "");
}

/**
 * The line for a raider whose profile has characters, but none of the event's
 * version (#543) — in the reader's language, with the link to the profile. "" otherwise.
 */
function missingVersionLine(profile, versionId, lang = "de") {
    if (!signableCharacters(profile).length || signableCharacters(profile, versionId).length) return "";
    return tr(lang, "No {version} character in your profile yet – create a {version} character in your [profile]({url}) or pick class and spec here.", {
        version: versionLabel(versionId), url: `${publicBaseUrl()}/profile`,
    });
}

/** The rule set's classes for the event's game version. */
function classesFor(event) {
    return rulesForEvent(event).classes;
}

/**
 * Complete the picks: a valid stored state stays, otherwise the current signup,
 * otherwise the main character with its first spec and the profile's "kann auch".
 */
function resolveState(event, profile, mine, state) {
    const chars = signableCharacters(profile, versionOfEvent(event));
    if (state) {
        const ch = chars.find((c) => c.key === state.character);
        // With profile characters only one of them counts; without, any spec of the rule set (or nothing yet).
        const specOk = ch
            ? ch.specs.some((s) => s.key === state.spec)
            : !chars.length && !state.character && (!state.spec || !!profiles.specInfo(state.spec));
        if (specOk) {
            const own = (profiles.specInfo(state.spec) || {}).role;
            return { character: ch ? ch.key : "", spec: state.spec, canAlso: state.canAlso.filter((r) => r !== own) };
        }
    }
    if (mine && mine.status !== "absence" && mine.spec) {
        const ch = profiles.findCharacter({ characters: chars }, mine.character);
        if (ch && ch.specs.some((s) => s.key === mine.spec)) {
            return { character: ch.key, spec: mine.spec, canAlso: mine.canAlso || [] };
        }
    }
    // the raider's first character of this version, in their own order (there is no main)
    const first = chars[0];
    if (!first) return { character: "", spec: "", canAlso: [] };
    const spec = first.specs[0].key;
    return { character: first.key, spec, canAlso: defaultCanAlso(profile, first.key, spec) };
}

function specName(specKey, lang = "de") {
    return specLabelOf(lang, profiles.specInfo(specKey));
}

function classLabel(event, classId, lang = "de") {
    const cls = classesFor(event).find((c) => c.id === classId);
    return cls ? classLabelOf(lang, cls) : classId;
}

/** "Tank 1/2 · Healer 1/3 · DPS 4/5" (without a target just the count). */
function roleCountLine(counts, lang = "de") {
    const part = (label, c) => `${label} ${c.n}${c.target ? `/${c.target}` : ""}`;
    return [part(tr(lang, "Tank"), counts.tank), part(tr(lang, "Healer"), counts.healer), part("DPS", counts.dps)].join(" · ");
}

/** "Thorwald · Protection" for a signup or a state (a character of `versionId` when given). */
function pickText(profile, character, spec, versionId = "", lang = "de") {
    const ch = profiles.findCharacter({ characters: signableCharacters(profile, versionId) }, character);
    const name = ch ? ch.name : String(character || "");
    return [name, specName(spec, lang)].filter(Boolean).join(" · ");
}

/** The text lines of the dialog: time and counts, the own status, the window, the profile hints, the notice. */
function dialogLines(event, { uid, signups, mine, profile, versionId, chars, win, notice, lang }) {
    const lines = [];
    const start = Number(event.startTime) || 0;
    lines.push([start ? `<t:${start}:f>` : "", roleCountLine(roleCounts(event, signups), lang)].filter(Boolean).join(" · "));
    if (mine) {
        const what = mine.status === "absence" ? "" : pickText(profile, mine.character, mine.spec, versionId, lang);
        lines.push(`${tr(lang, "Your status: **{status}**", { status: statusState(lang, mine.status) })}${what ? ` · ${what}` : ""}${mine.comment ? ` · „${mine.comment}“` : ""}`);
    }
    if (event.status === "cancelled") {
        const reason = event.cancel && event.cancel.reason;
        lines.push(reason ? tr(lang, "The event was cancelled – {reason}.", { reason }) : tr(lang, "The event was cancelled."));
    } else if (win.started) lines.push(tr(lang, "The raid has already started – signups are closed."));
    else if (event.signupsClosed) lines.push(tr(lang, "Signups are closed – you can only sign off now."));
    else if (win.deadlinePassed) lines.push(tr(lang, "The signup deadline has passed – only Absence or “Late” now."));
    const missing = missingVersionLine(profile, versionId, lang);
    if (missing) lines.push(missing);
    else if (!chars.length) {
        lines.push(tr(lang, "No character in your profile yet – pick class and spec here or [create a profile]({url}).", { url: `${publicBaseUrl()}/profile` }));
    }
    const partners = wishPartnersSignedUp(profile, signups.filter((s) => String(s.userId) !== uid));
    if (partners.length) lines.push(tr(lang, "Also signed up: {names}", { names: partners.map((p) => p.name).filter(Boolean).join(", ") }));
    if (notice) lines.push("", serviceText(lang, notice));
    return { lines, missing };
}

/** The character · spec select — or, without profile characters, the class and spec selects. */
function pickRows(event, chars, picks, lang) {
    if (chars.length) {
        const options = [];
        for (const c of chars) {
            for (const s of c.specs) {
                if (options.length >= MAX_OPTIONS) break;
                options.push({
                    label: `${c.name} · ${specName(s.key, lang) || s.key}`.slice(0, 100),
                    description: (GEAR_LABELS[s.gear] ? tr(lang, GEAR_LABELS[s.gear]) : "").slice(0, 100) || undefined,
                    value: `${c.key}|${s.key}`.slice(0, 100),
                    default: c.key === picks.character && s.key === picks.spec,
                });
            }
        }
        return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(pickId(event.id, "s", picks))
            .setPlaceholder(tr(lang, "Pick character · spec …"))
            .addOptions(options))];
    }
    const rows = [];
    const classes = classesFor(event);
    const classId = (profiles.specInfo(picks.spec) || {}).classId || "";
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(pickId(event.id, "k", picks))
        .setPlaceholder(tr(lang, "Pick a class …"))
        .addOptions(classes.slice(0, MAX_OPTIONS).map((c) => ({ label: classLabelOf(lang, c), value: c.id, default: c.id === classId })))));
    const cls = classes.find((c) => c.id === classId);
    if (cls) {
        rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(pickId(event.id, "s", picks))
            .setPlaceholder(tr(lang, "Pick a spec …"))
            .addOptions(cls.specs.map((s) => ({ label: specLabelOf(lang, s), value: `|${s.key}`, default: s.key === picks.spec })))));
    }
    return rows;
}

/**
 * The dialog payload for one member and one own event, in the member's language.
 * @param {object} event  an eventStore event
 * @param {string} userId
 * @param {{ state?: object|null, notice?: string, now?: number, lang?: string }} opts
 * @returns {{ embeds: object[], components: object[] }}
 */
function buildSignupDialog(event, userId, { state = null, notice = "", now = Date.now(), lang = "de" } = {}) {
    const uid = String(userId || "");
    const signups = listSignups(event.id);
    const mine = getSignup(event.id, uid);
    const profile = profiles.getProfile(uid) || { characters: [] };
    const versionId = versionOfEvent(event);
    const chars = signableCharacters(profile, versionId);
    const picks = resolveState(event, profile, mine, state);
    const win = signupWindow(event, now);
    const allowed = allowedStatuses(event, { now });
    const { lines, missing } = dialogLines(event, { uid, signups, mine, profile, versionId, chars, win, notice, lang });

    const embed = new EmbedBuilder()
        .setColor(embedAccentColor)
        .setTitle(String(event.title || "Raid").slice(0, 256))
        .setDescription(lines.join("\n").slice(0, 4000));

    const rows = pickRows(event, chars, picks, lang);

    const ownRole = (profiles.specInfo(picks.spec) || {}).role || "";
    const alsoRoles = ROLES.filter((r) => r !== ownRole);
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(pickId(event.id, "a", picks))
        .setPlaceholder(tr(lang, "Can also … (heal, off-tank, off-spec)"))
        .setMinValues(0)
        .setMaxValues(alsoRoles.length)
        .addOptions(alsoRoles.map((r) => ({ label: tr(lang, ALSO_LABELS[r]), value: r, default: picks.canAlso.includes(r) })))));

    const current = mine ? mine.status : "";
    rows.push(new ActionRowBuilder().addComponents(Object.keys(STATUS_CODES).map((status) => new ButtonBuilder()
        .setCustomId(statusId(event.id, status, picks))
        .setLabel(statusLabel(lang, status))
        .setStyle(status === "absence" ? ButtonStyle.Danger : (status === current ? ButtonStyle.Success : ButtonStyle.Secondary))
        .setDisabled(!allowed.includes(status) || (status !== "absence" && !picks.spec)))));

    const extra = [
        new ButtonBuilder()
            .setCustomId(commentId(event.id, picks))
            .setLabel(tr(lang, "Comment"))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!mine || win.started),
        new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(tr(lang, "Open on the web"))
            .setURL(`${publicBaseUrl()}/signups?event=${encodeURIComponent(event.id)}`),
    ];
    if (!chars.length) {
        const label = missing ? tr(lang, "Add a {version} character", { version: versionLabel(versionId) }).slice(0, 80) : tr(lang, "Create profile");
        extra.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(`${publicBaseUrl()}/profile`));
    }
    rows.push(new ActionRowBuilder().addComponents(extra));

    return { embeds: [embed.toJSON()], components: rows.map((r) => r.toJSON()) };
}

/** The confirmation line after a save. */
function savedNotice(signup, profile, versionId = "", lang = "de") {
    if (signup.status === "absence") return `✅ ${tr(lang, "Signed off.")}`;
    const what = pickText(profile, signup.character, signup.spec, versionId, lang);
    return `✅ ${tr(lang, "Saved: **{status}**", { status: statusState(lang, signup.status) })}${what ? ` (${what})` : ""}`;
}

/**
 * Modal asking for the character name — the path without a profile character.
 * In a version with last names (WoW Forever) it asks for "Vorname Nachname";
 * utils/signup/characterNames.js checks the answer either way.
 */
function buildCharacterModal(customId, { defaultName = "", classText = "", versionId = "", lang = "de" } = {}) {
    // No version handed in: the main version's name rule (#541).
    const lastName = allowsLastName(versionOfEvent({ versionId }));
    const max = lastName ? NAME_MAX : NAME_PART_MAX;
    const input = new TextInputBuilder()
        .setCustomId("character")
        .setLabel((classText ? tr(lang, "Your character's name ({class})", { class: classText }) : tr(lang, "Your character's name")).slice(0, 45))
        .setPlaceholder(lastName
            ? tr(lang, "First name Last name – at most {max} letters each", { max: NAME_PART_MAX })
            : tr(lang, "At most {max} letters", { max: NAME_PART_MAX }))
        .setStyle(TextInputStyle.Short)
        .setMinLength(NAME_PART_MIN)
        .setMaxLength(max)
        .setRequired(true);
    if (defaultName) input.setValue(String(defaultName).slice(0, max));
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(tr(lang, "Add a character"))
        .addComponents(new ActionRowBuilder().addComponents(input));
}

/** Modal for the signup comment, prefilled with the current one. */
function buildCommentModal(customId, comment = "", lang = "de") {
    const input = new TextInputBuilder()
        .setCustomId("comment")
        .setLabel(tr(lang, "Comment on your signup"))
        .setPlaceholder(tr(lang, "e.g. joining 15 minutes late"))
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(300)
        .setRequired(false);
    if (comment) input.setValue(String(comment).slice(0, 300));
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(tr(lang, "Comment"))
        .addComponents(new ActionRowBuilder().addComponents(input));
}

/**
 * Update the dialog message into a short answer embed (the event is gone, …) — #508.
 * `content` is already in the reader's language (or a German service message).
 */
function plainUpdate(interaction, content, event = null) {
    return interaction.update(answerUpdate(content, { event, lang: langOfInteraction(interaction) }));
}

module.exports = {
    PICK_PREFIX, STATUS_PREFIX, COMMENT_PREFIX, MAX_CUSTOM_ID, STATUS_CODES, STATUS_BY_CODE, STATUS_LABELS, STATUS_STATE, ALSO_LABELS, GEAR_LABELS, GEAR_TEXT,
    statusLabel, statusState, gearText, specName,
    encodeState, decodeState, pickId, statusId, commentId, parsePickId, parseStatusId, parseCommentId,
    signableCharacters, missingVersionLine, versionLabel, classesFor, classLabel, resolveState, roleCountLine, pickText,
    buildSignupDialog, savedNotice, buildCharacterModal, buildCommentModal, plainUpdate,
};
