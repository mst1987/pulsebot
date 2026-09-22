// Signing up for several raids at once, in Discord (#293). Started from the raid
// overview on the talk server ("Für alle Raids anmelden" / "Mehrere Raids
// wählen …") or from an event's character select ("Mehrere Charaktere …"):
//
//   Schritt 1  (only "Mehrere Raids"): an ephemeral message with a multi-select
//              of the coming raids (nothing preselected — the member picks),
//              the status for all of them and "Weiter: Charaktere".
//   Schritt 2  a modal: per raid a multi-select of the member's characters ·
//              specs — the topmost picked entry is the first choice, the others
//              "kann auch mit"; nothing picked skips the raid. At most five raids
//              per modal (Discord's limit of five fields); with more, the answer
//              carries "Weiter: Raids 6–10", because a modal cannot open the next
//              modal by itself. "Für alle Raids" asks once: one character select
//              for every raid plus the status.
//   Ergebnis   one line per raid: saved with its characters, skipped characters
//              with the reason, refused raids with the service's reason.
//
// Discord caps a customId at 100 characters, so the raids and the status live
// here, in memory, under a short token for 30 minutes (the pattern of
// eventDraft.js) — only for the member who started it. Everything is checked
// again on submit: every save goes through signupService.submitSignups.
//
//   signup-multi:<token>:r          step 1: raids select
//   signup-multi:<token>:s          step 1: status select
//   signup-multi:<token>:go:<page>  opens the modal of that page
//   signup-multi:<token>:m:<page>   the modal (submit)
//   signup-multi:e:<eventId>:<code> "Mehrere Charaktere …" of one event
const crypto = require("crypto");
const { shortServerTime, shortServerDate, discordTimestamp } = require("./discordTime");
const { embedAccentColor, publicBaseUrl } = require("../config/variables");
const eventStore = require("../web/eventStore");
const { getSignup, lastSignupOf } = require("../web/signupStore");
const { migrateSignup, MAX_CHARACTERS } = require("../web/signupCharacters");
const profiles = require("../web/raiderProfileStore");
const guildRoles = require("../web/guildRoles");
const { getConfig } = require("../web/settingsStore");
const { signupWindow } = require("../web/signupService");
const { emojiOption, specEmojiName, statusEmojiName } = require("../web/appEmojis");
const { STATUS_CODES, STATUS_BY_CODE, STATUS_LABELS, STATUS_STATE } = require("./signupDialog");
const { characterOptions, defaultPick } = require("./joinPicker");
const { toEnglish } = require("./botEnglish");

const PREFIX = "signup-multi";
const SESSION_TTL = 30 * 60 * 1000;
const PER_MODAL = 5;
const MAX_RAIDS = 25;
const MAX_OPTIONS = 25;
const GEAR_TEXT = { ready: "raid ready", usable: "usable", none: "no gear" };
const STATUS_ORDER = ["signed", "tentative", "late", "bench", "absence"];

const sessions = new Map();
const baseUrl = () => String(publicBaseUrl || "").replace(/\/+$/, "");

/** Remember a flow for one member; returns its token. */
function createSession(userId, { mode, eventIds, status = "signed" }, now = Date.now()) {
    for (const [token, s] of sessions) if (now - s.at > SESSION_TTL) sessions.delete(token);
    let token;
    do token = crypto.randomBytes(4).toString("hex"); while (sessions.has(token));
    sessions.set(token, {
        // "all" (Sign up for all raids) starts with everything picked; "multi"
        // (Pick several raids …) starts empty — the member chooses, nothing is
        // assumed on their behalf.
        userId: String(userId), mode, eventIds: [...eventIds], selected: mode === "multi" ? [] : [...eventIds],
        status: STATUS_CODES[status] ? status : "signed", results: [], at: now,
    });
    return token;
}

/** The flow under a token — only for the member who started it, and not after 30 minutes. */
function getSession(token, userId, now = Date.now()) {
    const s = sessions.get(String(token || ""));
    if (!s || s.userId !== String(userId) || now - s.at > SESSION_TTL) return null;
    s.at = now;
    return s;
}

function endSession(token) {
    sessions.delete(String(token || ""));
}

/** `{ token, action, page, eventId, status }` from a customId of this flow. */
function parseMultiId(customId) {
    const [, a = "", b = "", c = ""] = String(customId || "").split(":");
    if (a === "e") return { token: "", action: "one", eventId: b, status: STATUS_BY_CODE[c] || "signed", page: 0 };
    return { token: /^[a-f0-9]{8}$/.test(a) ? a : "", action: b, page: Math.max(0, Number(c) || 0), eventId: "", status: "" };
}

const multiId = (token, action, page) => [PREFIX, token, action, page === undefined ? null : page].filter((x) => x !== null).join(":");
const oneEventId = (eventId, status) => `${PREFIX}:e:${eventId}:${STATUS_CODES[status] || "s"}`;

// Select options and modal labels cannot render Discord timestamps, so they
// carry the date as English text in server time: "Wed 24 Sep 19:30".
const formatStart = shortServerTime;
const shortDate = shortServerDate;
const plain = (text) => String(text || "").replace(/[*_`~|[\]\\]/g, "").replace(/\s+/g, " ").trim();

/**
 * The own raids a member can sign up for from the overview: coming, not
 * begun, not cancelled or closed, of the event server and — when set — the
 * event categories; soonest first, at most 25. Raider roles and the deadline
 * are not filtered here: the result says per raid why it was refused.
 */
function signableRaids({ config = getConfig(), now = Date.now() } = {}) {
    const guildId = guildRoles.eventGuildId(config);
    const cats = Array.isArray(config.categoryIds) ? config.categoryIds.map(String) : [];
    return eventStore.listEvents(guildId, { sinceSeconds: Math.floor(now / 1000) })
        .filter((e) => !signupWindow(e, now).started)
        .filter((e) => e.status !== "cancelled" && e.signupsClosed !== true)
        .filter((e) => !cats.length || cats.includes(String(e.categoryId || "")))
        .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0))
        .slice(0, MAX_RAIDS);
}

const optionValue = (o) => `${o.character}|${o.spec}`;

/**
 * The characters · specs to preselect for a raid, in priority order: the
 * current signup's characters, else the spec signed up with last, else the
 * main's best-geared spec.
 */
function preselected(options, userId, eventId) {
    const mine = eventId ? migrateSignup(getSignup(eventId, userId)) : null;
    if (mine && mine.status !== "absence" && mine.characters && mine.characters.length) {
        const hits = mine.characters
            .map((c) => options.find((o) => o.character === profiles.characterKey(c.character) && o.spec === c.spec))
            .filter(Boolean);
        if (hits.length) return hits;
    }
    const pick = defaultPick(options, { last: lastSignupOf(userId) });
    return pick ? [pick] : [];
}

/** The select options, the preselected ones first in their order (the order decides the priority). */
function characterSelectOptions(options, picked, emojis) {
    const first = picked.map(optionValue);
    const ordered = [...picked, ...options.filter((o) => !first.includes(optionValue(o)))];
    return ordered.slice(0, MAX_OPTIONS).map((o) => {
        const info = profiles.specInfo(o.spec) || {};
        const option = {
            label: `${o.name} · ${info.labelEn || info.label || o.spec}`.slice(0, 100),
            value: optionValue(o).slice(0, 100),
            description: [o.main ? "Main" : "", GEAR_TEXT[o.gear] || ""].filter(Boolean).join(" · ").slice(0, 100) || undefined,
            default: first.includes(optionValue(o)),
        };
        const emoji = emojiOption(emojis, specEmojiName(o.spec));
        if (emoji) option.emoji = emoji;
        return option;
    });
}

/** The priority order of picked values: as the options list them (Discord does not keep the click order). */
function orderedPicks(values, optionList) {
    const set = new Set((values || []).map(String));
    return optionList.filter((o) => set.has(o.value)).map((o) => {
        const [character, spec] = o.value.split("|");
        return { character, spec };
    });
}

function statusSelect(customId, status, emojis) {
    return {
        type: 3,
        custom_id: customId,
        min_values: 1,
        max_values: 1,
        options: STATUS_ORDER.map((s) => {
            const option = { label: STATUS_LABELS[s], value: s, default: s === status };
            const emoji = emojiOption(emojis, statusEmojiName(s));
            if (emoji) option.emoji = emoji;
            return option;
        }),
    };
}

/** How many modals a flow needs. */
function pageCount(session) {
    return session.mode === "all" ? 1 : Math.max(1, Math.ceil(session.selected.length / PER_MODAL));
}

/** "Raids 6–10" for page 1. */
function pageRange(session, page) {
    const from = page * PER_MODAL + 1;
    const to = Math.min(session.selected.length, (page + 1) * PER_MODAL);
    return from === to ? `Raid ${from}` : `Raids ${from}–${to}`;
}

/** Step 1: which raids, and the status for all of them. */
function buildRaidPicker(token, session, events, { emojis = {}, notice = "" } = {}) {
    const byId = new Map(events.map((e) => [e.id, e]));
    const raids = session.eventIds.map((id) => byId.get(id)).filter(Boolean);
    const lines = [
        "Step 1 of 2 · only visible to you",
        session.mode === "multi"
            ? "Pick the raids you want to join. Next you pick your characters per raid."
            : "All coming raids are selected – remove what does not suit you. Next you pick your characters per raid.",
    ];
    if (session.selected.length > PER_MODAL) {
        lines.push(`${PER_MODAL} raids per window – after submitting, “Next” takes you to the following ones.`);
    }
    if (notice) lines.push("", notice);
    return {
        embeds: [{ color: embedAccentColor, title: "Which raids?", description: lines.join("\n") }],
        components: [
            {
                type: 1,
                components: [{
                    type: 3,
                    custom_id: multiId(token, "r"),
                    placeholder: "Pick raids …",
                    min_values: 1,
                    max_values: raids.length,
                    options: raids.map((e) => ({
                        label: (plain(e.title) || "Raid").slice(0, 100),
                        description: [formatStart(e.startTime), plain(e.categoryName)].filter(Boolean).join(" · ").slice(0, 100) || undefined,
                        value: e.id,
                        default: session.selected.includes(e.id),
                    })),
                }],
            },
            { type: 1, components: [{ ...statusSelect(multiId(token, "s"), session.status, emojis), placeholder: "Status for all" }] },
            {
                type: 1,
                components: [{
                    type: 2,
                    style: 1,
                    custom_id: multiId(token, "go", 0),
                    label: session.selected.length > PER_MODAL ? `Next: characters (${pageRange(session, 0)})` : "Next: characters",
                    disabled: !session.selected.length,
                }],
            },
        ],
    };
}

/** A modal field: label + description + one component (Discord's Label component). */
const labelled = (label, description, component) => ({
    type: 18,
    label: String(label).slice(0, 45),
    description: description ? String(description).slice(0, 100) : undefined,
    component,
});

/**
 * Step 2: the modal of one page. "all": one character select for every raid
 * plus the status; otherwise one select per raid of the page.
 * @returns {object|null} plain modal JSON, null without characters
 */
function buildCharacterModal(token, session, page, events, profile, { emojis = {} } = {}) {
    const options = characterOptions(profile);
    if (!options.length) return null;
    const max = Math.min(MAX_CHARACTERS, options.length);
    const hint = "Topmost pick = 1st choice, the others = “can also come with”";
    // Discord hands the picks back without their click order: remember the listed order.
    session.orders = session.orders || {};
    const select = (field, eventId) => {
        const list = characterSelectOptions(options, preselected(options, session.userId, eventId), emojis);
        session.orders[`${page}:${field}`] = list.map((o) => o.value);
        return list;
    };
    if (session.mode === "all") {
        return {
            custom_id: multiId(token, "m", 0),
            title: `Sign up for all ${session.selected.length} raids`.slice(0, 45),
            components: [
                labelled("Characters · specs for all raids", `${hint}. What does not fit a raid is skipped.`, {
                    type: 3, custom_id: "all", min_values: 1, max_values: max, required: true,
                    options: select("all", ""),
                }),
                labelled("Status for all", "", { ...statusSelect("status", session.status, emojis), required: true }),
            ],
        };
    }
    const byId = new Map(events.map((e) => [e.id, e]));
    const ids = session.selected.slice(page * PER_MODAL, (page + 1) * PER_MODAL);
    const pages = pageCount(session);
    const components = ids.map((id, i) => {
        const event = byId.get(id) || { id, title: id };
        return labelled(`${plain(event.title) || "Raid"} · ${shortDate(event.startTime)}`.trim(), session.mode === "one" ? hint : `${hint} · empty = skip`, {
            type: 3, custom_id: `r${i}`, min_values: session.mode === "one" ? 1 : 0, max_values: max, required: session.mode === "one",
            options: select(`r${i}`, id),
        });
    });
    return {
        custom_id: multiId(token, "m", page),
        title: `Which characters?${pages > 1 ? ` (${page + 1}/${pages})` : ""}`.slice(0, 45),
        components,
    };
}

/** The values of a select in a submitted modal, [] when it is missing. */
function modalValues(interaction, id) {
    try {
        const f = interaction.fields;
        if (f && typeof f.getStringSelectValues === "function") return [...(f.getStringSelectValues(id) || [])];
    } catch {
        // an empty optional select is not in the submission
    }
    return [];
}

/**
 * The entries for submitSignups from a submitted modal page. The priority is
 * the order the modal listed the options in (kept in the session when it was
 * built); a value the modal did not offer is dropped.
 * @returns {{ entries: object[], status: string }}
 */
function entriesFromModal(interaction, session, page) {
    const order = (field) => ((session.orders || {})[`${page}:${field}`] || []).map((value) => ({ value }));
    if (session.mode === "all") {
        const picked = modalValues(interaction, "status")[0];
        const status = STATUS_CODES[picked] ? picked : session.status;
        const characters = orderedPicks(modalValues(interaction, "all"), order("all"));
        return { status, entries: session.selected.map((eventId) => ({ eventId, characters, status })) };
    }
    const ids = session.selected.slice(page * PER_MODAL, (page + 1) * PER_MODAL);
    return {
        status: session.status,
        entries: ids.map((eventId, i) => ({
            eventId,
            characters: orderedPicks(modalValues(interaction, `r${i}`), order(`r${i}`)),
            status: session.status,
        })),
    };
}

/** "Zibbo · Holy" for a stored or requested character. */
function characterText(profile, c) {
    const ch = ((profile && profile.characters) || []).find((x) => x.key === profiles.characterKey(c.character));
    const info = profiles.specInfo(c.spec) || {};
    return [ch ? ch.name : c.character, info.labelEn || info.label || ""].filter(Boolean).join(" · ");
}

/** One result line: "✅ **SSC + TK** · <t:…:D>: Zibbo · Holy, +Zibbowar · Protection". */
function resultLine(result, profile) {
    // An embed renders Discord timestamps: every reader sees their own date format.
    const head = `**${plain(result.title) || "Raid"}**${result.startTime ? ` · ${discordTimestamp(result.startTime, "D")}` : ""}`;
    const skipped = (result.skipped || []).map((s) => `${characterText(profile, s)} skipped: ${toEnglish(s.reason)}`);
    if (result.ok) {
        const s = result.signup || {};
        const chars = (s.characters || []).map((c, i) => `${i ? "+" : ""}${characterText(profile, c)}`).join(", ");
        // A "Dabei" the full raid turned into a bench seat says so in words (#306).
        const status = result.waitlisted
            ? " – **Waiting list (bench)**"
            : (s.status && s.status !== "signed" ? ` – ${STATUS_STATE[s.status] || s.status}` : "");
        return `✅ ${head}: ${s.status === "absence" ? "signed off" : chars}${status}${skipped.length ? `\n   ↳ ${skipped.join("; ")}` : ""}`;
    }
    if (result.code === "no_character" && !skipped.length) return `⏭️ ${head}: skipped (no character picked)`;
    return `⛔ ${head}: ${toEnglish(result.error) || "not saved"}${skipped.length ? ` (${skipped.join("; ")})` : ""}`;
}

/**
 * The answer after a modal page: every result so far, and "Weiter" when pages are left.
 * @returns {{ embeds: object[], components: object[] }}
 */
function buildResults(token, session, { nextPage = null, profile = null } = {}) {
    const results = session.results;
    const saved = results.filter((r) => r.ok).length;
    const lines = results.map((r) => resultLine(r, profile));
    const title = nextPage === null
        ? `Signup: ${saved} of ${results.length} raids saved`
        : `So far ${saved} of ${results.length} raids saved`;
    let description = lines.join("\n");
    if (description.length > 4000) description = `${description.slice(0, 3990)}…`;
    const components = [];
    const buttons = [];
    if (nextPage !== null) {
        buttons.push({ type: 2, style: 1, custom_id: multiId(token, "go", nextPage), label: `Next: ${pageRange(session, nextPage)}` });
    }
    if (/^https?:\/\//.test(baseUrl())) buttons.push({ type: 2, style: 5, label: "My signups", url: `${baseUrl()}/signups` });
    if (buttons.length) components.push({ type: 1, components: buttons });
    return {
        embeds: [{ color: embedAccentColor, title, description: description || "Nothing picked." }],
        components,
    };
}

module.exports = {
    PREFIX, PER_MODAL, SESSION_TTL, MAX_RAIDS,
    createSession, getSession, endSession, parseMultiId, multiId, oneEventId,
    signableRaids, preselected, characterSelectOptions, orderedPicks, pageCount, pageRange,
    buildRaidPicker, buildCharacterModal, modalValues, entriesFromModal, resultLine, buildResults,
};
