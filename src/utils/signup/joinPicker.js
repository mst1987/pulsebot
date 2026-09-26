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
const { embedAccentColor } = require("../../config/variables");
const { publicBaseUrl } = require("../publicUrl");
const { getSignup, lastSignupOf } = require("../../stores/signupStore");
const profiles = require("../../stores/raiderProfileStore");
const { defaultCanAlso, signupWindow } = require("../../web/signupService");
const { buildClasses } = require("../../config/gameVersions/classes");
const { emojiOption, specEmojiName } = require("../../web/appEmojis");
const { toEnglish } = require("./botEnglish");
const {
    MAX_CUSTOM_ID, STATUS_CODES, STATUS_BY_CODE, STATUS_STATE,
    encodeState, decodeState, statusId, commentId, signableCharacters, pickText,
} = require("./signupDialog");

const JOIN_PREFIX = "event-join";
const MAX_OPTIONS = 25;
const GEAR_TEXT = { ready: "raid ready", usable: "usable", none: "no gear" };
const GEAR_RANK = { ready: 2, usable: 1, none: 0 };
const ROLE_TEXT = { tank: "Tank", healer: "Healer" };
const CLASS_LABEL = new Map(buildClasses().map((c) => [c.id, c.labelEn || c.label]));


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
 * "none" are left out while there are others — they are no real choice.
 * @returns {{ character: string, name: string, spec: string, gear: string, main: boolean, classId: string }[]}
 */
function characterOptions(profile) {
    const all = [];
    for (const c of signableCharacters(profile)) {
        for (const s of c.specs) {
            all.push({ character: c.key, name: c.name, spec: s.key, gear: s.gear, main: !!c.main, classId: c.className });
        }
    }
    const fitting = all.filter((o) => o.gear !== "none");
    return fitting.length ? fitting : all;
}

const sameOption = (o, character, spec) => o.character === profiles.characterKey(character) && o.spec === spec;

/**
 * The pick to preselect: the current signup, else the spec used last (any
 * event), else the main character's best-geared spec, else the first entry.
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
        // the spec alone decides, the main first.
        if (last.imported) {
            const bySpec = options.filter((o) => o.spec === last.spec);
            const specHit = bySpec.find((o) => o.main) || bySpec[0];
            if (specHit) return specHit;
        }
    }
    const mains = options.filter((o) => o.main);
    const pool = mains.length ? mains : options;
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
 * @param {{ state?: object|null, notice?: string, emojis?: object, now?: number }} opts
 * @returns {{ embeds: object[], components: object[] }}
 */
function buildJoinPicker(event, userId, status, { state = null, notice = "", emojis = {}, now = Date.now() } = {}) {
    const uid = String(userId || "");
    const profile = profiles.getProfile(uid) || { characters: [] };
    const mine = getSignup(event.id, uid);
    const last = lastSignupOf(uid);
    const options = characterOptions(profile);
    const picks = resolvePick(profile, options, { state, mine, last });
    const win = signupWindow(event, now);

    const lines = [];
    const start = Number(event.startTime) || 0;
    lines.push([`**${STATUS_STATE[status] || status}**`, start ? `<t:${start}:f>` : ""].filter(Boolean).join(" · "));
    lines.push("Which character? – from your EventHelper profile");
    if (mine) {
        const what = mine.status === "absence" ? "" : pickText(profile, mine.character, mine.spec);
        lines.push(`So far: **${STATUS_STATE[mine.status] || mine.status}**${what ? ` · ${what}` : ""}`);
    }
    if (win.deadlinePassed && !win.started) lines.push("The signup deadline has passed – only “Late” or Absence now.");
    if (notice) lines.push("", toEnglish(notice));

    const lastOption = last
        ? options.find((o) => sameOption(o, last.character, last.spec))
            || (last.imported ? defaultPick(options.filter((o) => o.spec === last.spec), { last }) : null)
        : null;
    const selectOptions = options.slice(0, MAX_OPTIONS).map((o) => {
        const info = profiles.specInfo(o.spec) || {};
        const description = [
            CLASS_LABEL.get(o.classId) || o.classId,
            GEAR_TEXT[o.gear] || "",
            ROLE_TEXT[info.role] || "",
            o.main ? "Main" : "",
            o === lastOption ? "last used" : "",
        ].filter(Boolean).join(" · ");
        const option = {
            label: `${o.name} · ${info.labelEn || info.label || o.spec}`.slice(0, 100),
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
                placeholder: "Pick character · spec …",
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
                label: status === "signed" ? "Sign up" : `Save: ${STATUS_STATE[status] || status}`,
                disabled: !picks.spec || win.started,
            },
            { type: 2, style: 2, custom_id: joinId(event.id, status, "m", picks), label: "Can also …", disabled: win.started },
            { type: 2, style: 2, custom_id: commentId(event.id, picks), label: "Comment", disabled: !mine || win.started },
            // Several own characters, first choice + "kann auch mit" (#293, commands/signup/signupMulti.js).
            ...(options.length > 1 && status !== "absence"
                ? [{ type: 2, style: 2, custom_id: `signup-multi:e:${event.id}:${STATUS_CODES[status] || "s"}`, label: "Several characters …", disabled: win.started }]
                : []),
        ],
    });
    // A link button needs an absolute url.
    if (/^https?:\/\//.test(publicBaseUrl())) {
        components[components.length - 1].components.push({ type: 2, style: 5, label: "Profile", url: `${publicBaseUrl()}/profile` });
    }

    const embed = {
        color: embedAccentColor,
        title: String(event.title || "Raid").slice(0, 256),
        description: lines.join("\n").slice(0, 4000),
    };
    return { embeds: [embed], components };
}

module.exports = {
    JOIN_PREFIX, joinId, parseJoinId, characterOptions, defaultPick, resolvePick, buildJoinPicker,
};
