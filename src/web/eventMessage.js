// The bot's own signup message for an EventHelper event, in the event's channel —
// the counterpart of Raid-Helper's widget (#254, rebuilt in #287).
//
// One embed laid out like Raid-Helper's (#303): title and description, a head
// of icon + value only in three columns whose rows sit directly under each
// other (leader · count · deadline, then date · time · countdown, the voice
// channel under the date — #305; no end time: a duration nobody set would show
// the default), the role totals as columns (Tanks · Ranged · Melee, Healers
// directly below the tanks) with flat role icons, then the roster — a "Tanks" block first, one
// block per class after it (class icon, underlined name and count; each line
// spec icon · signup number · name; three inline columns with an empty line
// between the rows), one line each for Late / Tentative / Bench / Absence —
// the approved setup and the links. The air between the parts comes from
// fields named with a zero-width space and one empty full-width field, all within 25 fields.
//
// Every character of a signup is listed where its own status puts it: a raider
// signed up with a healer and a tank shows up in both blocks, under the same
// number, and a first character on "Late" sits in the Late line while the
// second stays in its class block. The head's count and the role totals are
// per person (a raider takes one seat — the setup places one character, too).
//
// Icons are the bot's application emojis (appEmojis.js): WoW icons for specs
// and classes, flat grey line icons (`eh_ui_*`) for the head, the roles, the
// statuses and the buttons. Without them the icons are left out and the head
// lines carry their label ("Date: …") instead — no colourful unicode
// stand-ins.
//
// Everything a raider reads here is English (the community mostly is): the
// English class/spec labels (`labelEn`), English statuses and buttons, and
// every date a Discord timestamp, so each reader sees their own language and
// time zone. The web admin keeps its German labels.
//
// Below it one row with the public select `event-pick:<eventId>` — "My
// characters …" plus the classes of the event's game version (a public select
// is the same for everybody, so it cannot list anyone's own characters; the
// pick opens them ephemerally, commands/signup/eventPick.js) — and one row of
// buttons `event-btn:<eventId>:<action>` Late · Tentative · Bench · Absence
// (commands/signup/eventButton.js). After the deadline only Late · Absence, a
// closed signup only Absence, nothing once the raid started or for a cancelled
// event. Messages posted earlier carry the buttons Anmelden / Klasse wählen
// (#302), the select `event-join:<eventId>` (#287) or the button
// `event-signup:<eventId>` (#254); their handlers keep working until the
// message is redrawn.
//
// Posted when the event is created (eventCreate.js) and edited whenever its
// roster changes (signupStore.onSignupsChanged → startEventMessageSync: the
// first change redraws at once, further ones within the quiet window collapse
// into one redraw after it, and redraws of one event never overlap). Where the
// message sits is remembered on the event with the hash of what it shows
// (eventStore.setEventMessage); the sweep redraws every recent message whose
// payload no longer matches that hash — a phase that passed, or a redraw lost
// to a restart.
//
// The coloured bar and the picture come from embedLook.js (#307): the event's
// own colour and image, else the leading instance's colour and boss icon from
// the rule set — so a glance into the channel says which raid it is without
// anybody configuring anything. A cancelled event keeps the red bar and drops
// the picture.
//
// Nothing personal goes in beyond the character names the raiders signed up
// with — the names the channel would see in Raid-Helper, too.
const crypto = require("crypto");
const { publicBaseUrl } = require("../config/variables");
// Colour and picture of the embed (#307): the event's own, else the rule set of
// its instances, else the accent — and never a picture Discord cannot load.
const { embedColor, embedImageFields, messageLookOf } = require("./embedLook");
const { getEvent, setEventMessage, listEvents } = require("./eventStore");
const { listSignups, onSignupsChanged } = require("./signupStore");
const discord = require("./discord");
// The counting rule lives in the signup service, so the page and the message agree.
const { rosterCounts, allowedStatuses, signupWindow } = require("./signupService");
const { buildClasses } = require("../config/gameVersions/classes");
const { rulesFor, DEFAULT_VERSION } = require("../config/gameVersions");
const {
    appEmojiMap, loadAppEmojis, emojiText, emojiOption,
    specEmojiName, classEmojiName, roleUiEmojiName, statusEmojiName, uiEmojiName, tileEmojiName, roleEmojiName, emojiStyleOf,
} = require("./appEmojis");
const { migrateSignup } = require("./signupCharacters");
// The calendar link under the message (#308) — the route that serves it is
// public, like the report pages.
const { icsUrlFor } = require("./icsFeed");

// The old button id — messages posted before #287 carry it and keep working.
const SIGNUP_BUTTON_PREFIX = "event-signup";
// The select of #287 — messages posted before the buttons carry it and keep working.
const JOIN_SELECT_PREFIX = "event-join";
// The signup buttons: `event-btn:<eventId>:<action>` ("join"/"class" only on messages posted before #303).
const BUTTON_PREFIX = "event-btn";
const BUTTON_ACTIONS = ["join", "class", "absence", "late", "tentative", "bench"];
// The public signup select (#303): `event-pick:<eventId>`, value "mine" or a class id.
const PICK_PREFIX = "event-pick";
const PICK_MINE = "mine";
const EDIT_DEBOUNCE_MS = 2000;
const SWEEP_MS = 5 * 60 * 1000;
const FIRST_SWEEP_MS = 30 * 1000;
const CANCELLED_COLOR = 0xe0524f;
// An empty field name or value — Discord refuses a truly empty one.
const ZWS = "\u200b";

// Discord's embed limits.
const LIMITS = { title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, total: 6000, options: 25 };

// The statuses of the old select (#287) — its handler still reads them.
const STATUS_OPTIONS = {
    signed: { label: "Sign up", description: "pick a character" },
    tentative: { label: "Tentative", description: "not sure yet" },
    late: { label: "Late", description: "joining later" },
    bench: { label: "Bench", description: "ready as a backup" },
    absence: { label: "Absence", description: "not attending" },
};
// The lines below the class blocks, in this order.
const OTHER_LINES = [["late", "Late"], ["tentative", "Tentative"], ["bench", "Bench"], ["absence", "Absence"]];
// The role totals as Raid-Helper sets them: three columns, Tanks with Healers directly below.
const ROLE_TOTALS = [[["tank", "Tanks"], ["healer", "Healers"]], [["ranged", "Ranged"]], [["melee", "Melee"]]];

const CLASSES = buildClasses();
const SPEC_BY_KEY = new Map(CLASSES.flatMap((c) => c.specs.map((s) => [s.key, s])));

/** customId of the old signup button under an event message. */
function signupButtonId(eventId) {
    return `${SIGNUP_BUTTON_PREFIX}:${eventId}`;
}

/** customId of the public "Anmelden …" select (#287, still handled). */
function joinSelectId(eventId) {
    return `${JOIN_SELECT_PREFIX}:${eventId}`;
}

/** customId of a signup button under the message. */
function buttonId(eventId, action) {
    return `${BUTTON_PREFIX}:${eventId}:${action}`;
}

/** customId of the public signup select (#303). */
function pickSelectId(eventId) {
    return `${PICK_PREFIX}:${eventId}`;
}

const baseUrl = () => String(publicBaseUrl || "").replace(/\/+$/, "");
const clip = (text, max) => {
    const s = String(text || "");
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
/** A name as plain text — no bold, links or mentions sneaking in through markdown. */
const escapeMd = (text) => String(text || "").replace(/([\\*_~`|>[\]()])/g, "\\$1").replace(/@/g, "@\u200b");

/** The classes of the event's game version (the rule set's order). */
function classesOf(event) {
    const rules = rulesFor(event && event.versionId) || rulesFor(DEFAULT_VERSION);
    return (rules && rules.classes) || CLASSES;
}

/**
 * Where the event stands for its message: `cancelled` (the event management's
 * `event.status`, #288), `started`, `closed` (`event.signupsClosed`, or a
 * `status` of "closed"), `deadline` (passed, not started) or `open`.
 */
function messagePhase(event, now = Date.now()) {
    const status = String((event && event.status) || "");
    if (status === "cancelled") return "cancelled";
    const w = signupWindow(event, now);
    if (w.started) return "started";
    if (status === "closed" || (event && event.signupsClosed)) return "closed";
    if (w.deadlinePassed) return "deadline";
    return "open";
}

/**
 * Number every signup by when it was first made (`at`, then user id) — stable:
 * changing a spec keeps the number (the store keeps `at`), a new signup gets
 * the next one.
 * @returns {Map<string, number>} userId → number
 */
function signupNumbers(signups) {
    const sorted = (signups || [])
        .filter((s) => s && s.userId)
        .slice()
        .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0) || String(a.userId).localeCompare(String(b.userId)));
    return new Map(sorted.map((s, i) => [String(s.userId), i + 1]));
}

/** What the plan wants for a role: "/3", "/2–4", "/4+" or "". */
function targetText(event, role) {
    const min = Number(((event && event.composition) || {})[role]) || 0;
    const max = Number(((event && event.compositionMax) || {})[role]) || 0;
    if (role === "tank" || role === "healer") return min ? `/${min}` : "";
    if (max) return `/${min}–${max}`;
    return min ? `/${min}+` : "";
}

const nameOf = (entry) => escapeMd(entry.character) || `<@${entry.userId}>`;

/**
 * One line per listed character: every character of a signup with its own
 * status (a raider with a healer and a tank shows up in both blocks, under
 * the same number); an absence once per person.
 * @returns {{ userId: string, character: string, spec: string, role: string, status: string, index: number }[]}
 */
function rosterEntries(signups) {
    const out = [];
    for (const raw of signups || []) {
        if (!raw || !raw.userId) continue;
        const s = migrateSignup(raw);
        const base = { userId: String(s.userId) };
        if (s.status === "absence" || !(s.characters || []).length) {
            out.push({ ...base, character: s.character || "", spec: s.spec || "", role: s.role || "", status: s.status || "signed", index: 0 });
            continue;
        }
        s.characters.forEach((c, index) => out.push({ ...base, character: c.character, spec: c.spec, role: c.role, status: c.status || s.status, index }));
    }
    return out;
}

/**
 * One roster line: "<spec icon> `12` **Name**" — without the icon, the spec in
 * words. A raider's further character (`index` > 0, "kann auch mit") is not
 * bold: it is an offer, not a seat.
 */
function rosterLine(entry, number, emojis) {
    const icon = emojiText(emojis, specEmojiName(entry.spec));
    const num = `\`${number}\``;
    const name = entry.index > 0 ? nameOf(entry) : `**${nameOf(entry)}**`;
    if (icon) return `${icon} ${num} ${name}`;
    const spec = SPEC_BY_KEY.get(entry.spec);
    return `${num} ${name}${spec ? ` · ${spec.labelEn || spec.label}` : ""}`;
}

/** Lines as one field value: at most `maxLines` lines and `max` characters, "+N more" for the rest. */
function blockValue(lines, maxLines, max = LIMITS.fieldValue) {
    const out = [];
    let length = 0;
    for (let i = 0; i < lines.length; i++) {
        const after = lines.length - i - 1;
        const reserve = after ? `\n+${after} more`.length : 0;
        const next = length + (out.length ? 1 : 0) + lines[i].length;
        if (out.length >= maxLines || next + reserve > max) {
            out.push(`+${lines.length - i} more`);
            break;
        }
        out.push(lines[i]);
        length = next;
    }
    return out.join("\n") || ZWS;
}

/**
 * The approved setup as one embed field — "**Grp 1** Anna, Bert, …" per line,
 * the bench last. Only the approved snapshot (#263): a draft never reaches the
 * channel. "" without an approval.
 */
function approvedSetupText(event) {
    // Lazily: setupEditor pulls in the proposal's inputs, which this module does not need otherwise.
    const { approvedSetupOf } = require("./setupEditor");
    const approved = approvedSetupOf(event);
    if (!approved) return "";
    const names = (list) => list.map((s) => escapeMd(s.character) || "?").join(", ");
    const lines = approved.groups
        .filter((g) => (g.slots || []).length)
        .map((g) => `**Grp ${g.index}** ${names(g.slots)}`);
    if ((approved.bench || []).length) lines.push(`**Bench** ${names(approved.bench)}`);
    return clip(lines.join("\n"), LIMITS.fieldValue);
}

/** Characters Discord counts against the 6000 of an embed. */
function embedLength(embed) {
    return String(embed.title || "").length
        + String(embed.description || "").length
        + String((embed.footer && embed.footer.text) || "").length
        + (embed.fields || []).reduce((n, f) => n + String(f.name).length + String(f.value).length, 0);
}

// A title longer than this stays text — the tiles would wrap into a wall.
const MAX_TILES = 32;
// How large the tiles are (embedLook.TITLE_SIZES): a markdown heading before the line.
const TITLE_HEADINGS = { normal: "", large: "## ", huge: "# " };

/**
 * The title as a line of letter tiles, Raid-Helper's look ("Hyjal+BT" →
 * H Y J A L + B T as emojis). Umlauts become AE/OE/UE, words are set apart by
 * an em space; `style` is the event's emoji style. null when a character has
 * no tile, a tile is not uploaded (yet), the title is too long or the style is
 * "plain" — the embed then keeps its plain title.
 */
function titleTiles(title, emojis, style) {
    const text = String(title || "").trim().toUpperCase()
        .replace(/Ä/g, "AE").replace(/Ö/g, "OE").replace(/Ü/g, "UE");
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length || words.join("").length > MAX_TILES) return null;
    const out = [];
    for (const word of words) {
        const tiles = [...word].map((c) => emojiText(emojis, tileEmojiName(c, style)));
        if (tiles.some((t) => !t)) return null;
        out.push(tiles.join(""));
    }
    return out.join("   ");
}

/** A role's icon in the event's style, else the flat one (a style not uploaded yet), else "". */
const roleIcon = (emojis, role, style) => emojiText(emojis, roleEmojiName(role, style)) || emojiText(emojis, roleUiEmojiName(role));

/** "<icon> Label" or just "Label" when the emoji is missing. */
const labelled = (emojis, name, label) => [emojiText(emojis, name), label].filter(Boolean).join(" ");

/** An empty field: inline it fills a column, full-width it is an empty line. */
const spacer = (inline) => ({ name: ZWS, value: ZWS, inline, spacer: true });

/** The roster fields — Tank block, class blocks, the other statuses — with at most `maxLines` per block. */
function rosterFields(entries, numbers, emojis, maxLines, style) {
    const numberOf = (e) => numbers.get(String(e.userId));
    const byNumber = (a, b) => numberOf(a) - numberOf(b) || a.index - b.index;
    const signed = entries.filter((e) => e.status === "signed");
    const fields = [];
    const block = (icon, label, list) => {
        // A raider's first character first, in signup order; their further
        // characters below all of them — and only the first ones count.
        const first = list.filter((e) => !(e.index > 0)).sort(byNumber);
        const further = list.filter((e) => e.index > 0).sort(byNumber);
        const sorted = [...first, ...further];
        // "<icon> __Priest__ (3)"; the empty last line keeps the rows of blocks apart.
        fields.push({
            name: clip(`${icon ? `${icon} ` : ""}__${label}__ (${first.length})`, LIMITS.fieldName),
            value: `${blockValue(sorted.map((e) => rosterLine(e, numberOf(e), emojis)), maxLines, LIMITS.fieldValue - 2)}\n${ZWS}`,
            inline: true,
        });
    };
    const tanks = signed.filter((e) => e.role === "tank");
    // The Tanks block wears the Protection Warrior's icon — the WoW picture of a
    // tank beside the class blocks' WoW icons; the flat role icon as fallback.
    if (tanks.length) block(emojiText(emojis, specEmojiName("Warrior-Protection")) || roleIcon(emojis, "tank", style), "Tanks", tanks);
    for (const cls of CLASSES) {
        const members = signed.filter((e) => e.role !== "tank" && (SPEC_BY_KEY.get(e.spec) || {}).classId === cls.id);
        if (members.length) block(emojiText(emojis, classEmojiName(cls.id)), cls.labelEn || cls.label, members);
    }
    // Signed without a known spec (the service does not let that happen) is still shown.
    const unknown = signed.filter((e) => e.role !== "tank" && !SPEC_BY_KEY.get(e.spec));
    if (unknown.length) block("", "No spec", unknown);
    // Two columns per row, not three: character names were wrapping too early
    // at a third of the embed's (fixed, Discord-controlled) width (#351).
    // Discord spreads a row of fewer than two inline fields over the whole
    // width, so its block would stand out wider than the pairs above — an
    // empty inline field fills an odd one out.
    for (let i = fields.length % 2; i && i < 2; i++) fields.push(spacer(true));

    const other = [];
    for (const [status, label] of OTHER_LINES) {
        // One entry per raider: several characters on the same status share one
        // number and count once ("`3` Darkdisi / Lakunoc").
        const people = new Map();
        for (const e of entries.filter((x) => x.status === status).sort(byNumber)) {
            const key = String(e.userId);
            if (!people.has(key)) people.set(key, { entry: e, names: [] });
            people.get(key).names.push(nameOf(e));
        }
        const list = [...people.values()];
        if (!list.length) continue;
        const shown = list.slice(0, maxLines * 2).map((p) => `\`${numberOf(p.entry)}\` ${p.names.join(" / ")}`);
        const more = list.length - shown.length;
        other.push(`${labelled(emojis, statusEmojiName(status), label)} (${list.length}): ${shown.join(", ")}${more ? ` +${more} more` : ""}`);
    }
    if (other.length) fields.push({ name: ZWS, value: clip(other.join("\n"), LIMITS.fieldValue), inline: false });
    return fields;
}

/**
 * At most 25 fields: the spacers go first (the full-width one, then the head's
 * filler), only then is the tail cut. The internal `spacer` mark is dropped.
 */
function fitFields(fields) {
    const out = fields.slice();
    while (out.length > LIMITS.fields) {
        let at = -1;
        for (let i = out.length - 1; i >= 0; i--) {
            if (out[i].spacer && !out[i].inline) { at = i; break; }
        }
        if (at < 0) at = out.map((f) => !!f.spacer).lastIndexOf(true);
        if (at < 0) break;
        out.splice(at, 1);
    }
    return out.slice(0, LIMITS.fields).map(({ name, value, inline }) => ({ name, value, inline }));
}

const BUTTON_STYLE = { primary: 1, secondary: 2, success: 3, danger: 4 };
const BUTTONS = {
    late: { label: "Late", style: BUTTON_STYLE.secondary, icon: "late" },
    tentative: { label: "Tentative", style: BUTTON_STYLE.secondary, icon: "tentative" },
    bench: { label: "Bench", style: BUTTON_STYLE.secondary, icon: "bench" },
    absence: { label: "Absence", style: BUTTON_STYLE.danger, icon: "absence" },
};

/**
 * Which components a phase offers, as rows: before the deadline the signup
 * select ("pick") and Late · Tentative · Bench · Absence; after it
 * Late · Absence; a closed signup only Absence; nothing once the raid started
 * or the event was cancelled.
 */
function buttonRows(event, phase, now = Date.now()) {
    if (phase === "open") {
        const allowed = allowedStatuses(event, { now });
        const buttons = ["late", "tentative", "bench"].filter((a) => allowed.includes(a));
        return [allowed.includes("signed") ? ["pick"] : [], [...buttons, "absence"]].filter((r) => r.length);
    }
    if (phase === "deadline") return [["late", "absence"]];
    if (phase === "closed") return event && event.signupsClosed ? [["absence"]] : [];
    return [];
}

/**
 * The public signup select: "My characters …" first, then every class of the
 * event's game version. The same for everybody — a message component cannot
 * differ per viewer — so the own characters open ephemerally (eventPick.js).
 */
function pickSelect(event, emojis) {
    const mine = { label: "My characters …", value: PICK_MINE, description: "from your profile – up to 3 at once" };
    const mineEmoji = emojiOption(emojis, uiEmojiName("signups"));
    if (mineEmoji) mine.emoji = mineEmoji;
    const classes = classesOf(event).map((c) => {
        const option = { label: c.labelEn || c.label, value: c.id };
        const emoji = emojiOption(emojis, classEmojiName(c.id));
        if (emoji) option.emoji = emoji;
        return option;
    });
    return {
        type: 3,
        custom_id: pickSelectId(event.id),
        placeholder: "Sign up – pick a character or class …",
        min_values: 1,
        max_values: 1,
        options: [mine, ...classes].slice(0, LIMITS.options),
    };
}

/** The select and buttons under the message for the event's current phase, as component rows. */
function messageComponents(event, { emojis = {}, now = Date.now(), phase = messagePhase(event, now) } = {}) {
    return buttonRows(event, phase, now).map((row) => ({
        type: 1,
        components: row.map((action) => {
            if (action === "pick") return pickSelect(event, emojis);
            const b = BUTTONS[action];
            const button = { type: 2, style: b.style, custom_id: buttonId(event.id, action), label: b.label };
            const emoji = emojiOption(emojis, uiEmojiName(b.icon));
            if (emoji) button.emoji = emoji;
            return button;
        }),
    }));
}

/**
 * The message payload for an event and its signups — pure, plain API JSON.
 * @param {object} event   an eventStore event (`status` "cancelled" / "closed" is honoured, #288)
 * @param {object[]} signups signupStore signups
 * @param {{ emojis?: object, now?: number, icsUrl?: string }} opts
 *   `emojis`: name → { id, name, animated } (appEmojis.appEmojiMap()); none = labels only
 *   `icsUrl`: the calendar link; empty = the event's own `/r/cal/<id>.ics` (#308)
 */
function buildEventMessage(event, signups, { emojis = {}, now = Date.now(), icsUrl = "", raidArt = false, titleSize = "normal" } = {}) {
    const list = (signups || []).filter((s) => s && s.userId).map(migrateSignup);
    const c = rosterCounts(list);
    const phase = messagePhase(event, now);
    const numbers = signupNumbers(list);
    const entries = rosterEntries(list);
    const start = Number(event.startTime) || 0;
    const deadline = Number(event.signupDeadline) || 0;
    // letter tiles and role icons in the style the event picked (arcane unless it says otherwise)
    const style = emojiStyleOf(event.emojiStyle);
    const head = (icon, label) => labelled(emojis, uiEmojiName(icon), label);

    const desc = [];
    if (phase === "cancelled") {
        // The store keeps the reason in `cancel.reason` (eventManage.cancelEvent).
        const reason = (event.cancel && event.cancel.reason) || event.cancelReason || "";
        desc.push(`${head("absence", "**Cancelled**")}${reason ? ` – ${escapeMd(clip(reason, 300))}` : ""}`);
    } else if (phase === "closed") {
        desc.push(`${head("closed", "**Signups closed**")}${event.signupsClosed ? " – you can still sign off." : ""}`);
    } else if (phase === "started") {
        desc.push("The raid has started – signups are closed.");
    } else if (phase === "deadline") {
        desc.push("The signup deadline has passed – only “Late” or Absence now.");
    }
    const description = String(event.description || "").trim();
    if (description) {
        if (desc.length) desc.push("");
        desc.push(clip(description, 1500));
    }

    // Three columns, their values as lines of one field each — so the rows sit
    // directly under each other like Raid-Helper's head, not a field (and its
    // empty name) apart. Icon + value; without the icon "Label: value".
    const headLine = (icon, label, value) => {
        const e = emojiText(emojis, uiEmojiName(icon));
        return e ? `${e} ${value}` : `${label}: ${value}`;
    };
    const column = (lines) => ({ name: ZWS, value: lines.join("\n"), inline: true });
    const headFields = [
        column([
            headLine("leader", "Leader", event.leaderId ? `<@${event.leaderId}>` : "–"),
            headLine("date", "Date", start ? `<t:${start}:D>` : "–"),
            // where the raid meets (#305), only when there is a channel
            ...(event.voiceChannelId ? [headLine("voice", "Voice channel", `<#${event.voiceChannelId}>`)] : []),
        ]),
        column([
            headLine("signups", "Signed up", `**${c.attending}**${event.size ? ` / ${event.size}` : ""}`),
            headLine("time", "Time", start ? `<t:${start}:t>` : "–"),
        ]),
        // an empty first line without a deadline keeps the countdown beside date and time
        column([
            deadline ? headLine("deadline", "Deadline", `<t:${deadline}:f>`) : ZWS,
            headLine("start", "Start", start ? `<t:${start}:R>` : "–"),
        ]),
    ];
    // Who takes a seat, per role and per person (rosterCounts folds melee and ranged into dps).
    const seats = { tank: c.tank, healer: c.healer, melee: 0, ranged: 0 };
    for (const s of list) {
        if (["signed", "late"].includes(s.status || "signed") && (s.role === "melee" || s.role === "ranged")) seats[s.role] += 1;
    }
    // Tanks with the healers directly below, then Fernkampf, then Nahkampf.
    const total = (role, label) => `${[roleIcon(emojis, role, style), label].filter(Boolean).join(" ")} **${seats[role]}**${targetText(event, role)}`;
    const totals = [
        ...ROLE_TOTALS.map((col) => column(col.map(([role, label]) => total(role, label)))),
        spacer(false),
    ];

    const tail = [];
    // The approved setup now lives in its own message (setupMessage.js) beside
    // this one — an inline preview here only duplicated it and wrapped badly
    // for a full roster. Only the link below stays.
    const setupText = approvedSetupText(event);
    const base = baseUrl();
    const id = encodeURIComponent(event.id);
    const links = [];
    // The public event page first (#308): it is the link everyone in the channel
    // can open, with or without a menu account. The menu link stays beside it —
    // that is where one signs up and where the orga works.
    if (base) links.push(`[Event](${base}/e/${id})`);
    if (base) links.push(`[Sign up](${base}/signups?event=${id})`);
    if (base && setupText) links.push(`[Setup](${base}/raids/detail?event=${id}&tab=setup)`);
    const cal = icsUrl || icsUrlFor(event.id);
    if (cal) links.push(`[Calendar](${cal})`);
    if (links.length) tail.push({ name: ZWS, value: links.join("  ·  "), inline: false });

    const title = phase === "cancelled" ? `Cancelled: ${event.title || "Raid"}` : (event.title || "Raid");
    // The title as letter tiles opens the description — an embed title cannot
    // show emojis. A cancelled event keeps "Cancelled: …" as plain text.
    const tiles = phase === "cancelled" ? null : titleTiles(title, emojis, style);
    // A markdown heading enlarges the tiles — an emoji grows with the line it
    // sits in, and a heading is the only larger line an embed description has.
    if (tiles) desc.unshift(`${TITLE_HEADINGS[titleSize] || ""}${tiles}`, ...(desc.length ? [""] : []));
    // A cancelled event keeps the red bar and loses its picture: "Cancelled"
    // should read as off, not as an advert for the raid (#307).
    const embed = {
        ...(tiles ? {} : { title: clip(title, LIMITS.title) }),
        color: phase === "cancelled" ? CANCELLED_COLOR : embedColor(event),
        ...(phase === "cancelled" ? {} : embedImageFields(event, { raidArt })),
        fields: [],
    };
    const text = clip(desc.join("\n"), LIMITS.description);
    if (text) embed.description = text;
    // Shorten the blocks until the whole embed fits Discord's 6000 characters.
    for (let maxLines = 40; maxLines >= 1; maxLines -= maxLines > 10 ? 5 : 1) {
        embed.fields = fitFields([...headFields, ...totals, ...rosterFields(entries, numbers, emojis, maxLines, style), ...tail]);
        if (embedLength(embed) <= LIMITS.total) break;
    }
    return { content: "", embeds: [embed], components: messageComponents(event, { emojis, now, phase }) };
}

/** What a payload shows, as a short hash — the sweep redraws a message whose hash is outdated. */
function payloadHash(payload) {
    return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

async function textChannel(channelId) {
    const client = discord.getClient();
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("Channel nicht gefunden oder kein Textkanal.");
    return channel;
}

/** The payload with the application emojis (read once per process; labels without them). */
async function payloadFor(event) {
    await loadAppEmojis(discord.getClient());
    // The category's look (Einstellungen › Kategorien): raid picture and title size.
    const { getConfig } = require("./settingsStore");
    const look = messageLookOf(getConfig(), event.categoryId);
    return buildEventMessage(event, listSignups(event.id), { emojis: appEmojiMap(), raidArt: look.raidArt, titleSize: look.titleSize });
}

async function postPayload(event, payload) {
    const channel = await textChannel(event.channelId);
    const posted = await channel.send(payload);
    const where = { channelId: channel.id, messageId: posted.id };
    setEventMessage(event.id, { ...where, hash: payloadHash(payload) });
    return where;
}

/**
 * Post the event's message into its channel and remember where it sits.
 * @returns {Promise<{ channelId: string, messageId: string }>}
 */
async function postEventMessage(eventId) {
    const event = getEvent(eventId);
    if (!event) throw new Error("Event nicht gefunden.");
    return postPayload(event, await payloadFor(event));
}

/**
 * Bring the event's message up to date: edit it in place, or post it anew when
 * there is none yet or it was deleted in Discord. A message that already shows
 * exactly this payload (same hash) is left alone.
 * @returns {Promise<{ channelId: string, messageId: string, reposted: boolean, unchanged?: true }|null>} null for an unknown event
 */
async function refreshEventMessage(eventId) {
    const event = getEvent(eventId);
    if (!event) return null;
    const payload = await payloadFor(event);
    const hash = payloadHash(payload);
    if (event.message) {
        if (event.message.hash === hash) {
            return { channelId: event.message.channelId, messageId: event.message.messageId, reposted: false, unchanged: true };
        }
        try {
            const channel = await textChannel(event.message.channelId);
            const message = await channel.messages.fetch(event.message.messageId);
            await message.edit(payload);
            setEventMessage(event.id, { channelId: event.message.channelId, messageId: event.message.messageId, hash });
            return { channelId: event.message.channelId, messageId: event.message.messageId, reposted: false };
        } catch (e) {
            // A message deleted by hand is re-posted; anything else is reported.
            if (!(e && (e.code === 10008 || /unknown message/i.test(e.message || "")))) throw e;
        }
    }
    const where = await postPayload(event, payload);
    return { ...where, reposted: true };
}

// One redraw per event at a time: a later redraw waits for the one before, so
// an older payload can never land after a newer one.
const chains = new Map();

function serially(eventId, fn) {
    const before = chains.get(eventId) || Promise.resolve();
    const run = before.then(fn).catch((e) => console.error(`[eventMessage] ${eventId}:`, e.message));
    chains.set(eventId, run);
    run.then(() => {
        if (chains.get(eventId) === run) chains.delete(eventId);
    });
    return run;
}

/** Redraw one event's message now (queued behind a redraw that is still running). */
function redrawEventMessage(eventId) {
    return serially(String(eventId), () => refreshEventMessage(eventId));
}

/**
 * One sweep over the events of the last two days and the coming ones: every
 * message whose payload changed since it was drawn is edited — a deadline or
 * start that passed, or a roster change whose redraw was lost (a restart).
 */
async function sweepEventMessages(now = Date.now()) {
    const since = Math.floor(now / 1000) - 2 * 86400;
    for (const event of listEvents("", { sinceSeconds: since })) {
        if (!event || !event.id || !event.message) continue;
        await redrawEventMessage(event.id);
    }
}

let sync = null;

/**
 * Keep every event message current. A roster change redraws at once when the
 * event's message was not drawn within `debounceMs`; changes inside that window
 * collapse into one redraw at its end. A sweep every `sweepMs` (the first after
 * `firstSweepMs`) catches what changed without a roster change.
 * Idempotent; returns the stop function.
 */
function startEventMessageSync({ debounceMs = EDIT_DEBOUNCE_MS, sweepMs = SWEEP_MS, firstSweepMs = FIRST_SWEEP_MS } = {}) {
    if (sync) return sync.stop;
    // eventId → { timer, dirty, running, quietUntil }
    const state = new Map();
    const timers = new Set();
    const later = (fn, ms) => {
        const t = setTimeout(() => {
            timers.delete(t);
            fn();
        }, ms);
        if (t.unref) t.unref();
        timers.add(t);
        return t;
    };
    const schedule = (eventId) => {
        const s = state.get(eventId);
        if (s.timer || s.running || !s.dirty) return;
        s.timer = later(() => fire(eventId), Math.max(0, s.quietUntil - Date.now()));
    };
    const fire = (eventId) => {
        const s = state.get(eventId);
        if (!s) return;
        s.timer = null;
        s.dirty = false;
        s.running = true;
        redrawEventMessage(eventId).then(() => {
            s.running = false;
            s.quietUntil = Date.now() + debounceMs;
            schedule(eventId);
        });
    };
    const off = onSignupsChanged((eventId) => {
        const id = String(eventId);
        if (!state.has(id)) state.set(id, { timer: null, dirty: false, running: false, quietUntil: 0 });
        state.get(id).dirty = true;
        schedule(id);
    });
    const runSweep = () => sweepEventMessages().catch((e) => console.error("[eventMessage] sweep:", e.message));
    const sweep = sweepMs > 0 ? setInterval(runSweep, sweepMs) : null;
    if (sweep && sweep.unref) sweep.unref();
    if (sweepMs > 0 && firstSweepMs > 0) later(runSweep, firstSweepMs);
    const stop = () => {
        off();
        if (sweep) clearInterval(sweep);
        for (const t of timers) clearTimeout(t);
        timers.clear();
        state.clear();
        sync = null;
    };
    sync = { stop };
    return stop;
}

module.exports = {
    SIGNUP_BUTTON_PREFIX, JOIN_SELECT_PREFIX, BUTTON_PREFIX, BUTTON_ACTIONS, PICK_PREFIX, PICK_MINE, STATUS_OPTIONS, LIMITS,
    signupButtonId, joinSelectId, buttonId, pickSelectId, buttonRows, messageComponents, rosterEntries, classesOf,
    rosterCounts, messagePhase, signupNumbers, embedLength, blockValue, payloadHash, titleTiles,
    buildEventMessage, approvedSetupText, sweepEventMessages, redrawEventMessage,
    postEventMessage, refreshEventMessage, startEventMessageSync,
};
