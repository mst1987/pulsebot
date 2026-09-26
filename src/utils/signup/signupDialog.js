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
const { rulesFor, DEFAULT_VERSION } = require("../../config/gameVersions");
const { ROLES } = require("../../config/gameVersions/classes");
const { toEnglish } = require("./botEnglish");
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
// Raider-facing, so English (like every signup text in Discord).
const STATUS_LABELS = { signed: "Sign up", tentative: "Tentative", late: "Late", bench: "Bench", absence: "Absence" };
const STATUS_STATE = { signed: "Signed up", tentative: "Tentative", late: "Late", bench: "Bench", absence: "Absence" };
const ROLE_CODES = { tank: "t", healer: "h", melee: "m", ranged: "r" };
const ALSO_LABELS = { tank: "Off-tank", healer: "Heal", melee: "Melee (off-spec)", ranged: "Ranged (off-spec)" };
const GEAR_LABELS = { none: "no gear", usable: "gear usable", ready: "gear raid ready" };
// The English label of a class or spec, the German one as a fallback.
const en = (x) => (x && (x.labelEn || x.label)) || "";


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

/** The characters of a profile that can sign up (have at least one spec). */
function signableCharacters(profile) {
    return ((profile && profile.characters) || []).filter((c) => c.specs.length);
}

/** The rule set's classes for the event's game version. */
function classesFor(event) {
    const rules = rulesFor(event && event.versionId) || rulesFor(DEFAULT_VERSION);
    return rules.classes;
}

/**
 * Complete the picks: a valid stored state stays, otherwise the current signup,
 * otherwise the main character with its first spec and the profile's "kann auch".
 */
function resolveState(event, profile, mine, state) {
    const chars = signableCharacters(profile);
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
        const key = profiles.characterKey(mine.character);
        const ch = chars.find((c) => c.key === key);
        if (ch && ch.specs.some((s) => s.key === mine.spec)) {
            return { character: ch.key, spec: mine.spec, canAlso: mine.canAlso || [] };
        }
    }
    const main = chars.find((c) => c.main) || chars[0];
    if (!main) return { character: "", spec: "", canAlso: [] };
    const spec = main.specs[0].key;
    return { character: main.key, spec, canAlso: defaultCanAlso(profile, main.key, spec) };
}

function specLabel(specKey) {
    const info = profiles.specInfo(specKey);
    return info ? en(info) : "";
}

function classLabel(event, classId) {
    const cls = classesFor(event).find((c) => c.id === classId);
    return cls ? en(cls) : classId;
}

/** "Tank 1/2 · Healer 1/3 · DPS 4/5" (without a target just the count). */
function roleCountLine(counts) {
    const part = (label, c) => `${label} ${c.n}${c.target ? `/${c.target}` : ""}`;
    return [part("Tank", counts.tank), part("Healer", counts.healer), part("DPS", counts.dps)].join(" · ");
}

/** "Thorwald · Protection" for a signup or a state. */
function pickText(profile, character, spec) {
    const ch = signableCharacters(profile).find((c) => c.key === profiles.characterKey(character));
    const name = ch ? ch.name : String(character || "");
    return [name, specLabel(spec)].filter(Boolean).join(" · ");
}

/**
 * The dialog payload for one member and one own event.
 * @param {object} event  an eventStore event
 * @param {string} userId
 * @param {{ state?: object|null, notice?: string, now?: number }} opts
 * @returns {{ embeds: object[], components: object[] }}
 */
function buildSignupDialog(event, userId, { state = null, notice = "", now = Date.now() } = {}) {
    const uid = String(userId || "");
    const signups = listSignups(event.id);
    const mine = getSignup(event.id, uid);
    const profile = profiles.getProfile(uid) || { characters: [] };
    const chars = signableCharacters(profile);
    const picks = resolveState(event, profile, mine, state);
    const win = signupWindow(event, now);
    const allowed = allowedStatuses(event, { now });

    const lines = [];
    const start = Number(event.startTime) || 0;
    lines.push([start ? `<t:${start}:f>` : "", roleCountLine(roleCounts(event, signups))].filter(Boolean).join(" · "));
    if (mine) {
        const what = mine.status === "absence" ? "" : pickText(profile, mine.character, mine.spec);
        lines.push(`Your status: **${STATUS_STATE[mine.status] || mine.status}**${what ? ` · ${what}` : ""}${mine.comment ? ` · „${mine.comment}“` : ""}`);
    }
    if (event.status === "cancelled") lines.push(`The event was cancelled${event.cancel && event.cancel.reason ? ` – ${event.cancel.reason}` : ""}.`);
    else if (win.started) lines.push("The raid has already started – signups are closed.");
    else if (event.signupsClosed) lines.push("Signups are closed – you can only sign off now.");
    else if (win.deadlinePassed) lines.push("The signup deadline has passed – only Absence or “Late” now.");
    if (!chars.length) {
        lines.push(`No character in your profile yet – pick class and spec here or [create a profile](${publicBaseUrl()}/profile).`);
    }
    const partners = wishPartnersSignedUp(profile, signups.filter((s) => String(s.userId) !== uid));
    if (partners.length) lines.push(`Also signed up: ${partners.map((p) => p.name).filter(Boolean).join(", ")}`);
    if (notice) lines.push("", toEnglish(notice));

    const embed = new EmbedBuilder()
        .setColor(embedAccentColor)
        .setTitle(String(event.title || "Raid").slice(0, 256))
        .setDescription(lines.join("\n").slice(0, 4000));

    const rows = [];
    if (chars.length) {
        const options = [];
        for (const c of chars) {
            for (const s of c.specs) {
                if (options.length >= MAX_OPTIONS) break;
                options.push({
                    label: `${c.name} · ${specLabel(s.key) || s.key}`.slice(0, 100),
                    description: [c.main ? "Main" : "", GEAR_LABELS[s.gear] || ""].filter(Boolean).join(" · ").slice(0, 100) || undefined,
                    value: `${c.key}|${s.key}`.slice(0, 100),
                    default: c.key === picks.character && s.key === picks.spec,
                });
            }
        }
        rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(pickId(event.id, "s", picks))
            .setPlaceholder("Pick character · spec …")
            .addOptions(options)));
    } else {
        const classes = classesFor(event);
        const classId = (profiles.specInfo(picks.spec) || {}).classId || "";
        rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(pickId(event.id, "k", picks))
            .setPlaceholder("Pick a class …")
            .addOptions(classes.slice(0, MAX_OPTIONS).map((c) => ({ label: en(c), value: c.id, default: c.id === classId })))));
        const cls = classes.find((c) => c.id === classId);
        if (cls) {
            rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
                .setCustomId(pickId(event.id, "s", picks))
                .setPlaceholder("Pick a spec …")
                .addOptions(cls.specs.map((s) => ({ label: en(s), value: `|${s.key}`, default: s.key === picks.spec })))));
        }
    }

    const ownRole = (profiles.specInfo(picks.spec) || {}).role || "";
    const alsoRoles = ROLES.filter((r) => r !== ownRole);
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(pickId(event.id, "a", picks))
        .setPlaceholder("Can also … (heal, off-tank, off-spec)")
        .setMinValues(0)
        .setMaxValues(alsoRoles.length)
        .addOptions(alsoRoles.map((r) => ({ label: ALSO_LABELS[r], value: r, default: picks.canAlso.includes(r) })))));

    const current = mine ? mine.status : "";
    rows.push(new ActionRowBuilder().addComponents(Object.keys(STATUS_CODES).map((status) => new ButtonBuilder()
        .setCustomId(statusId(event.id, status, picks))
        .setLabel(STATUS_LABELS[status])
        .setStyle(status === "absence" ? ButtonStyle.Danger : (status === current ? ButtonStyle.Success : ButtonStyle.Secondary))
        .setDisabled(!allowed.includes(status) || (status !== "absence" && !picks.spec)))));

    const extra = [
        new ButtonBuilder()
            .setCustomId(commentId(event.id, picks))
            .setLabel("Comment")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!mine || win.started),
        new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel("Open on the web")
            .setURL(`${publicBaseUrl()}/signups?event=${encodeURIComponent(event.id)}`),
    ];
    if (!chars.length) {
        extra.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Create profile").setURL(`${publicBaseUrl()}/profile`));
    }
    rows.push(new ActionRowBuilder().addComponents(extra));

    return { embeds: [embed.toJSON()], components: rows.map((r) => r.toJSON()) };
}

/** The confirmation line after a save. */
function savedNotice(signup, profile) {
    if (signup.status === "absence") return "✅ Signed off.";
    const what = pickText(profile, signup.character, signup.spec);
    return `✅ Saved: **${STATUS_STATE[signup.status]}**${what ? ` (${what})` : ""}`;
}

/**
 * Modal asking for the character name — the path without a profile character.
 * In a version with last names (WoW Forever) it asks for "Vorname Nachname";
 * utils/signup/characterNames.js checks the answer either way.
 */
function buildCharacterModal(customId, { defaultName = "", classText = "", versionId = DEFAULT_VERSION } = {}) {
    const lastName = allowsLastName(versionId || DEFAULT_VERSION);
    const max = lastName ? NAME_MAX : NAME_PART_MAX;
    const input = new TextInputBuilder()
        .setCustomId("character")
        .setLabel(`Your character's name${classText ? ` (${classText})` : ""}`.slice(0, 45))
        .setPlaceholder(lastName ? `First name Last name – at most ${NAME_PART_MAX} letters each` : `At most ${NAME_PART_MAX} letters`)
        .setStyle(TextInputStyle.Short)
        .setMinLength(NAME_PART_MIN)
        .setMaxLength(max)
        .setRequired(true);
    if (defaultName) input.setValue(String(defaultName).slice(0, max));
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle("Add a character")
        .addComponents(new ActionRowBuilder().addComponents(input));
}

/** Modal for the signup comment, prefilled with the current one. */
function buildCommentModal(customId, comment = "") {
    const input = new TextInputBuilder()
        .setCustomId("comment")
        .setLabel("Comment on your signup")
        .setPlaceholder("e.g. joining 15 minutes late")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(300)
        .setRequired(false);
    if (comment) input.setValue(String(comment).slice(0, 300));
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle("Comment")
        .addComponents(new ActionRowBuilder().addComponents(input));
}

/** Reply to or update the dialog message with a short text (the event is gone, …). */
function plainUpdate(interaction, content) {
    return interaction.update({ content: toEnglish(content), embeds: [], components: [] });
}

module.exports = {
    PICK_PREFIX, STATUS_PREFIX, COMMENT_PREFIX, MAX_CUSTOM_ID, STATUS_CODES, STATUS_BY_CODE, STATUS_LABELS, STATUS_STATE, ALSO_LABELS, GEAR_LABELS,
    encodeState, decodeState, pickId, statusId, commentId, parsePickId, parseStatusId, parseCommentId,
    signableCharacters, classesFor, classLabel, resolveState, roleCountLine, pickText,
    buildSignupDialog, savedNotice, buildCharacterModal, buildCommentModal, plainUpdate,
};
