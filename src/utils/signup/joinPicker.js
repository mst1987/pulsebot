// The character select behind the event message's "Anmelden …" (#287): after
// a raider picked a status in the public select, only they see this message —
// their own characters · specs from the EventHelper profile, with spec icon,
// gear level, "Main" and "zuletzt", and three buttons:
//
//   Anmelden        signup-status:<eventId>:<code>:<state>   (signupStatus.js saves)
//   Kann auch …     event-join:<eventId>:<code>:m:<state>    (opens the full dialog)
//   Kommentar       signup-comment:<eventId>:<state>         (signupComment.js)
//
// The select itself is `event-join:<eventId>:<code>:c:<state>` and only redraws
// with the new pick. <code> is the status (s/t/l/b/a), <state> the dialog's
// `<characterKey>:<specKey>:<roleMask>` — the same state signupDialog.js
// carries, so its handlers take over seamlessly. A customId is a hint, never a
// permission: every save goes through signupService.submitSignup.
// Only the member sees it: the texts are in their language (`lang`).
const { embedAccentColor } = require("../../config/variables");
const { publicBaseUrl } = require("../publicUrl");
const { getSignup, lastSignupOf } = require("../../stores/signupStore");
const profiles = require("../../stores/raiderProfileStore");
const { defaultCanAlso, signupWindow } = require("../../services/signups/signupService");
const { versionOfEvent } = require("../../services/events/mainVersion");
const { getEvent } = require("../../stores/eventStore");
const { buildClasses } = require("../../config/gameVersions/classes");
const { LEGACY_VERSION } = require("../../config/gameVersions");
const { emojiOption, specEmojiName } = require("../../services/discord/appEmojis");
const { tr, serviceText, specLabel, classLabel } = require("../i18n/botText");
const {
    MAX_CUSTOM_ID, STATUS_CODES, STATUS_BY_CODE, statusState, gearText,
    encodeState, decodeState, statusId, commentId, signableCharacters, pickText, missingVersionLine,
} = require("./signupDialog");

const JOIN_PREFIX = "event-join";
const MAX_OPTIONS = 25;
const GEAR_RANK = { ready: 2, usable: 1, none: 0 };
// English, translated with tr(lang, ROLE_TEXT[role]).
const ROLE_TEXT = { tank: "Tank", healer: "Healer" };
const CLASS_INFO = new Map(buildClasses().map((c) => [c.id, c]));


/** customId of a picker component; the state is dropped when the id would pass 100 characters. */
function joinId(eventId, status, field, state) {
    const head = `${JOIN_PREFIX}:${eventId}:${STATUS_CODES[status] || ""}:${field}`;
    const id = `${head}:${encodeState(state)}`;
    return id.length <= MAX_CUSTOM_ID ? id : head.slice(0, MAX_CUSTOM_ID);
}

/**
 * Reads `event-join:<eventId>` (the public select: field "") or
 * `event-join:<eventId>:<code>:<field>:<state>`.
 */
function parseJoinId(customId) {
    const [, eventId = "", code = "", field = "", ...rest] = String(customId || "").split(":");
    return { eventId, status: STATUS_BY_CODE[code] || "", field, state: decodeState(rest) };
}

/**
 * Every character · spec of a profile, as select entries. Specs with gear
 * "none" are left out while there are others — they are no real choice. With
 * `versionId` only the characters of that game version (#543, the event's).
 * `first`: the raider's first character in their own order (there is no main).
 * @returns {{ character: string, name: string, spec: string, gear: string, first: boolean, classId: string }[]}
 */
function characterOptions(profile, versionId = "") {
    const all = [];
    const chars = signableCharacters(profile, versionId);
    for (const c of chars) {
        for (const s of c.specs) {
            all.push({ character: c.key, name: c.name, spec: s.key, gear: s.gear, first: c === chars[0], classId: c.className });
        }
    }
    const fitting = all.filter((o) => o.gear !== "none");
    return fitting.length ? fitting : all;
}

// By name: an option's character is its key ("forever~devi res"), a signup keeps the name ("Devi Res").
const sameOption = (o, character, spec) => profiles.nameKey(o.character) === profiles.nameKey(character) && o.spec === spec;

/** "Last signed up as" within one game version (#543): own signups of that version's events, else its imported specs. */
function lastSignupInVersion(userId, versionId) {
    return lastSignupOf(userId, {
        versionId,
        versionOf: (eventId) => {
            const event = getEvent(eventId);
            // an event that is gone (or a Raid-Helper one) is from before versions: TBC
            return event ? versionOfEvent(event) : LEGACY_VERSION;
        },
    });
}

/**
 * The pick to preselect: the current signup, else the spec used last (any
 * event), else the raider's first character's best-geared spec, else the first entry.
 */
function defaultPick(options, { mine = null, last = null } = {}) {
    if (!options.length) return null;
    if (mine && mine.status !== "absence" && mine.spec) {
        const hit = options.find((o) => sameOption(o, mine.character, mine.spec));
        if (hit) return hit;
    }
    if (last) {
        const hit = options.find((o) => sameOption(o, last.character, last.spec));
        if (hit) return hit;
        // A spec imported from Raid-Helper (#291) knows no profile character:
        // the spec alone decides, the raider's first character first.
        if (last.imported) {
            const bySpec = options.filter((o) => o.spec === last.spec);
            const specHit = bySpec.find((o) => o.first) || bySpec[0];
            if (specHit) return specHit;
        }
    }
    const firsts = options.filter((o) => o.first);
    const pool = firsts.length ? firsts : options;
    return pool.slice().sort((a, b) => (GEAR_RANK[b.gear] || 0) - (GEAR_RANK[a.gear] || 0))[0];
}

/**
 * The picks for the picker: a valid state from the customId, else the default.
 * "Kann auch" comes from the state, the current signup (same spec) or the profile.
 */
function resolvePick(profile, options, { state = null, mine = null, last = null } = {}) {
    const fromState = state && options.find((o) => o.character === state.character && o.spec === state.spec);
    const pick = fromState || defaultPick(options, { mine, last });
    if (!pick) return { character: "", spec: "", canAlso: [] };
    const own = (profiles.specInfo(pick.spec) || {}).role;
    let canAlso;
    if (fromState) canAlso = state.canAlso;
    else if (mine && sameOption(pick, mine.character, mine.spec)) canAlso = mine.canAlso || [];
    else canAlso = defaultCanAlso(profile, pick.character, pick.spec);
    return { character: pick.character, spec: pick.spec, canAlso: (canAlso || []).filter((r) => r !== own) };
}

/**
 * The picker payload for one member, one own event and the status they chose.
 * @param {{ state?: object|null, notice?: string, emojis?: object, now?: number, lang?: string }} opts
 * @returns {{ embeds: object[], components: object[] }}
 */
function buildJoinPicker(event, userId, status, { state = null, notice = "", emojis = {}, now = Date.now(), lang = "de" } = {}) {
    const uid = String(userId || "");
    const profile = profiles.getProfile(uid) || { characters: [] };
    const mine = getSignup(event.id, uid);
    const versionId = versionOfEvent(event);
    const last = lastSignupInVersion(uid, versionId);
    const options = characterOptions(profile, versionId);
    const picks = resolvePick(profile, options, { state, mine, last });
    const win = signupWindow(event, now);

    const lines = [];
    const start = Number(event.startTime) || 0;
    lines.push([`**${statusState(lang, status)}**`, start ? `<t:${start}:f>` : ""].filter(Boolean).join(" · "));
    lines.push(tr(lang, "Which character? – from your EventHelper profile"));
    if (mine) {
        const what = mine.status === "absence" ? "" : pickText(profile, mine.character, mine.spec, versionId, lang);
        lines.push(`${tr(lang, "So far: **{status}**", { status: statusState(lang, mine.status) })}${what ? ` · ${what}` : ""}`);
    }
    if (win.deadlinePassed && !win.started) lines.push(tr(lang, "The signup deadline has passed – only “Late” or Absence now."));
    const missing = missingVersionLine(profile, versionId, lang);
    if (missing) lines.push(missing);
    if (notice) lines.push("", serviceText(lang, notice));

    const lastOption = last
        ? options.find((o) => sameOption(o, last.character, last.spec))
            || (last.imported ? defaultPick(options.filter((o) => o.spec === last.spec), { last }) : null)
        : null;
    const selectOptions = options.slice(0, MAX_OPTIONS).map((o) => {
        const info = profiles.specInfo(o.spec) || {};
        const description = [
            classLabel(lang, CLASS_INFO.get(o.classId), o.classId),
            gearText(lang, o.gear),
            ROLE_TEXT[info.role] ? tr(lang, ROLE_TEXT[info.role]) : "",
            o === lastOption ? tr(lang, "last used") : "",
        ].filter(Boolean).join(" · ");
        const option = {
            label: `${o.name} · ${specLabel(lang, info) || o.spec}`.slice(0, 100),
            value: `${o.character}|${o.spec}`.slice(0, 100),
            description: description.slice(0, 100),
            default: o.character === picks.character && o.spec === picks.spec,
        };
        const emoji = emojiOption(emojis, specEmojiName(o.spec));
        if (emoji) option.emoji = emoji;
        return option;
    });

    const components = [];
    if (selectOptions.length) {
        components.push({
            type: 1,
            components: [{
                type: 3,
                custom_id: joinId(event.id, status, "c", picks),
                placeholder: tr(lang, "Pick character · spec …"),
                min_values: 1,
                max_values: 1,
                options: selectOptions,
            }],
        });
    }
    components.push({
        type: 1,
        components: [
            {
                type: 2,
                style: 3,
                custom_id: statusId(event.id, status, picks),
                label: status === "signed" ? tr(lang, "Sign up") : tr(lang, "Save: {status}", { status: statusState(lang, status) }),
                disabled: !picks.spec || win.started,
            },
            { type: 2, style: 2, custom_id: joinId(event.id, status, "m", picks), label: tr(lang, "Can also …"), disabled: win.started },
            { type: 2, style: 2, custom_id: commentId(event.id, picks), label: tr(lang, "Comment"), disabled: !mine || win.started },
            // Several own characters, first choice + "kann auch mit" (#293, commands/signup/signupMulti.js).
            ...(options.length > 1 && status !== "absence"
                ? [{ type: 2, style: 2, custom_id: `signup-multi:e:${event.id}:${STATUS_CODES[status] || "s"}`, label: tr(lang, "Several characters …"), disabled: win.started }]
                : []),
        ],
    });
    // A link button needs an absolute url.
    if (/^https?:\/\//.test(publicBaseUrl())) {
        components[components.length - 1].components.push({ type: 2, style: 5, label: tr(lang, "Profile"), url: `${publicBaseUrl()}/profile` });
    }

    const embed = {
        color: embedAccentColor,
        title: String(event.title || "Raid").slice(0, 256),
        description: lines.join("\n").slice(0, 4000),
    };
    return { embeds: [embed], components };
}

module.exports = {
    JOIN_PREFIX, joinId, parseJoinId, characterOptions, defaultPick, resolvePick, buildJoinPicker, lastSignupInVersion,
};
