// The bot's own signup message for an EventHelper event, in the event's channel —
// the counterpart of Raid-Helper's widget (#254, rebuilt in #287).
//
// One embed laid out like Raid-Helper's (#303): title and description, a head
// of icon + value only (leader · count · deadline, then date · time ·
// countdown), the role totals as columns (Tanks · Fernkampf · Nahkampf, Heiler
// below) with flat role icons, then the roster — a "Tanks" block first, one
// block per class after it (class icon, underlined name and count; each line
// spec icon · signup number · name; three inline columns with an empty line
// between the rows), one line each for Spät / Vielleicht / Bank / Abgemeldet —
// the approved setup and the links. The air between the parts comes from
// fields named with a zero-width space and one empty full-width field, all within 25 fields.
//
// Every character of a signup is listed where its own status puts it: a raider
// signed up with a healer and a tank shows up in both blocks, under the same
// number, and a first character on "Spät" sits in the Spät line while the
// second stays in its class block. The head's count and the role totals are
// per person (a raider takes one seat — the setup places one character, too).
//
// Icons are the bot's application emojis (appEmojis.js): WoW icons for specs
// and classes, flat grey line icons (`eh_ui_*`) for the head, the roles, the
// statuses and the buttons. Without them the icons are left out and the head
// fields carry their label as the field name instead — no colourful unicode
// stand-ins.
//
// Below it one row with the public select `event-pick:<eventId>` — "Meine
// Charaktere …" plus the classes of the event's game version (a public select
// is the same for everybody, so it cannot list anyone's own characters; the
// pick opens them ephemerally, commands/signup/eventPick.js) — and one row of
// buttons `event-btn:<eventId>:<action>` Spät · Vielleicht · Bank · Absagen
// (commands/signup/eventButton.js). After the deadline only Spät · Absagen, a
// closed signup only Absagen, nothing once the raid started or for a cancelled
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
// Nothing personal goes in beyond the character names the raiders signed up
// with — the names the channel would see in Raid-Helper, too.
const crypto = require("crypto");
const { embedAccentColor, publicBaseUrl } = require("../config/variables");
const { getEvent, setEventMessage, listEvents } = require("./eventStore");
const { listSignups, onSignupsChanged } = require("./signupStore");
const discord = require("./discord");
// The counting rule lives in the signup service, so the page and the message agree.
const { rosterCounts, allowedStatuses, signupWindow } = require("./signupService");
const { buildClasses } = require("../config/gameVersions/classes");
const { rulesFor, DEFAULT_VERSION } = require("../config/gameVersions");
const {
    appEmojiMap, loadAppEmojis, emojiText, emojiOption,
    specEmojiName, classEmojiName, roleUiEmojiName, statusEmojiName, uiEmojiName,
} = require("./appEmojis");
const { migrateSignup } = require("./signupCharacters");

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
    signed: { label: "Dabei", description: "mit Charakter-Auswahl" },
    tentative: { label: "Vielleicht", description: "noch unsicher" },
    late: { label: "Spät", description: "komme später" },
    bench: { label: "Bank", description: "als Ersatz bereit" },
    absence: { label: "Abmelden", description: "nicht dabei" },
};
// The lines below the class blocks, in this order.
const OTHER_LINES = [["late", "Spät"], ["tentative", "Vielleicht"], ["bench", "Bank"], ["absence", "Abgemeldet"]];
// The role totals as Raid-Helper sets them: three columns, the healers below.
const ROLE_TOTALS = [["tank", "Tanks"], ["ranged", "Fernkampf"], ["melee", "Nahkampf"], ["healer", "Heiler"]];

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

/** One roster line: "<spec icon> `12` **Name**" — without the icon, the spec in words. */
function rosterLine(entry, number, emojis) {
    const icon = emojiText(emojis, specEmojiName(entry.spec));
    const num = `\`${number}\``;
    if (icon) return `${icon} ${num} **${nameOf(entry)}**`;
    const spec = SPEC_BY_KEY.get(entry.spec);
    return `${num} **${nameOf(entry)}**${spec ? ` · ${spec.label}` : ""}`;
}

/** Lines as one field value: at most `maxLines` lines and `max` characters, "+N weitere" for the rest. */
function blockValue(lines, maxLines, max = LIMITS.fieldValue) {
    const out = [];
    let length = 0;
    for (let i = 0; i < lines.length; i++) {
        const after = lines.length - i - 1;
        const reserve = after ? `\n+${after} weitere`.length : 0;
        const next = length + (out.length ? 1 : 0) + lines[i].length;
        if (out.length >= maxLines || next + reserve > max) {
            out.push(`+${lines.length - i} weitere`);
            break;
        }
        out.push(lines[i]);
        length = next;
    }
    return out.join("\n") || ZWS;
}

/**
 * The approved setup as one embed field — "**Gr. 1** Anna, Bert, …" per line,
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
        .map((g) => `**Gr. ${g.index}** ${names(g.slots)}`);
    if ((approved.bench || []).length) lines.push(`**Bank** ${names(approved.bench)}`);
    return clip(lines.join("\n"), LIMITS.fieldValue);
}

/** Characters Discord counts against the 6000 of an embed. */
function embedLength(embed) {
    return String(embed.title || "").length
        + String(embed.description || "").length
        + String((embed.footer && embed.footer.text) || "").length
        + (embed.fields || []).reduce((n, f) => n + String(f.name).length + String(f.value).length, 0);
}

/** "<icon> Label" or just "Label" when the emoji is missing. */
const labelled = (emojis, name, label) => [emojiText(emojis, name), label].filter(Boolean).join(" ");

/** An empty field: inline it fills a column, full-width it is an empty line. */
const spacer = (inline) => ({ name: ZWS, value: ZWS, inline, spacer: true });

/** The roster fields — Tank block, class blocks, the other statuses — with at most `maxLines` per block. */
function rosterFields(entries, numbers, emojis, maxLines) {
    const numberOf = (e) => numbers.get(String(e.userId));
    const byNumber = (a, b) => numberOf(a) - numberOf(b) || a.index - b.index;
    const signed = entries.filter((e) => e.status === "signed");
    const fields = [];
    const block = (icon, label, list) => {
        const sorted = list.slice().sort(byNumber);
        // "<icon> __Priester__ (3)"; the empty last line keeps the rows of blocks apart.
        fields.push({
            name: clip(`${icon ? `${icon} ` : ""}__${label}__ (${sorted.length})`, LIMITS.fieldName),
            value: `${blockValue(sorted.map((e) => rosterLine(e, numberOf(e), emojis)), maxLines, LIMITS.fieldValue - 2)}\n${ZWS}`,
            inline: true,
        });
    };
    const tanks = signed.filter((e) => e.role === "tank");
    if (tanks.length) block(emojiText(emojis, roleUiEmojiName("tank")), "Tanks", tanks);
    for (const cls of CLASSES) {
        const members = signed.filter((e) => e.role !== "tank" && (SPEC_BY_KEY.get(e.spec) || {}).classId === cls.id);
        if (members.length) block(emojiText(emojis, classEmojiName(cls.id)), cls.label, members);
    }
    // Signed without a known spec (the service does not let that happen) is still shown.
    const unknown = signed.filter((e) => e.role !== "tank" && !SPEC_BY_KEY.get(e.spec));
    if (unknown.length) block("", "Ohne Spec", unknown);

    const other = [];
    for (const [status, label] of OTHER_LINES) {
        const list = entries.filter((e) => e.status === status).sort(byNumber);
        if (!list.length) continue;
        const shown = list.slice(0, maxLines * 2).map((e) => `\`${numberOf(e)}\` ${nameOf(e)}`);
        const more = list.length - shown.length;
        other.push(`${labelled(emojis, statusEmojiName(status), label)} (${list.length}): ${shown.join(", ")}${more ? ` +${more} weitere` : ""}`);
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
    late: { label: "Spät", style: BUTTON_STYLE.secondary, icon: "late" },
    tentative: { label: "Vielleicht", style: BUTTON_STYLE.secondary, icon: "tentative" },
    bench: { label: "Bank", style: BUTTON_STYLE.secondary, icon: "bench" },
    absence: { label: "Absagen", style: BUTTON_STYLE.danger, icon: "absence" },
};

/**
 * Which components a phase offers, as rows: before the deadline the signup
 * select ("pick") and Spät · Vielleicht · Bank · Absagen; after it
 * Spät · Absagen; a closed signup only Absagen; nothing once the raid started
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
 * The public signup select: "Meine Charaktere …" first, then every class of the
 * event's game version. The same for everybody — a message component cannot
 * differ per viewer — so the own characters open ephemerally (eventPick.js).
 */
function pickSelect(event, emojis) {
    const mine = { label: "Meine Charaktere …", value: PICK_MINE, description: "aus deinem Profil – bis zu 3 auf einmal" };
    const mineEmoji = emojiOption(emojis, uiEmojiName("signups"));
    if (mineEmoji) mine.emoji = mineEmoji;
    const classes = classesOf(event).map((c) => {
        const option = { label: c.label, value: c.id };
        const emoji = emojiOption(emojis, classEmojiName(c.id));
        if (emoji) option.emoji = emoji;
        return option;
    });
    return {
        type: 3,
        custom_id: pickSelectId(event.id),
        placeholder: "Anmelden – Charakter oder Klasse wählen …",
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
 */
function buildEventMessage(event, signups, { emojis = {}, now = Date.now(), icsUrl = "" } = {}) {
    const list = (signups || []).filter((s) => s && s.userId).map(migrateSignup);
    const c = rosterCounts(list);
    const phase = messagePhase(event, now);
    const numbers = signupNumbers(list);
    const entries = rosterEntries(list);
    const start = Number(event.startTime) || 0;
    const deadline = Number(event.signupDeadline) || 0;
    const head = (icon, label) => labelled(emojis, uiEmojiName(icon), label);

    const desc = [];
    if (phase === "cancelled") {
        // The store keeps the reason in `cancel.reason` (eventManage.cancelEvent).
        const reason = (event.cancel && event.cancel.reason) || event.cancelReason || "";
        desc.push(`${head("absence", "**Abgesagt**")}${reason ? ` – ${escapeMd(clip(reason, 300))}` : ""}`);
    } else if (phase === "closed") {
        desc.push(`${head("closed", "**Anmeldung geschlossen**")}${event.signupsClosed ? " – Abmelden geht weiter." : ""}`);
    } else if (phase === "started") {
        desc.push("Der Raid hat begonnen – Anmeldungen sind geschlossen.");
    } else if (phase === "deadline") {
        desc.push("Anmeldeschluss vorbei – nur noch „Spät“ oder Absagen.");
    }
    const description = String(event.description || "").trim();
    if (description) {
        if (desc.length) desc.push("");
        desc.push(clip(description, 1500));
    }

    // Icon + value only; the empty name above each value is the air between the rows.
    // Without the icon the label stands in the name instead.
    const headField = (icon, label, value) => {
        const e = emojiText(emojis, uiEmojiName(icon));
        return e ? { name: ZWS, value: `${e} ${value}`, inline: true } : { name: label, value, inline: true };
    };
    const headFields = [
        headField("leader", "Leitung", event.leaderId ? `<@${event.leaderId}>` : "–"),
        headField("signups", "Angemeldet", `**${c.attending}**${event.size ? ` / ${event.size}` : ""}`),
        deadline ? headField("deadline", "Anmeldeschluss", `<t:${deadline}:f>`) : spacer(true),
        headField("date", "Datum", start ? `<t:${start}:D>` : "–"),
        headField("time", "Uhrzeit", start ? `<t:${start}:t>` : "–"),
        headField("start", "Start", start ? `<t:${start}:R>` : "–"),
    ];
    // Who takes a seat, per role and per person (rosterCounts folds melee and ranged into dps).
    const seats = { tank: c.tank, healer: c.healer, melee: 0, ranged: 0 };
    for (const s of list) {
        if (["signed", "late"].includes(s.status || "signed") && (s.role === "melee" || s.role === "ranged")) seats[s.role] += 1;
    }
    const totals = [
        ...ROLE_TOTALS.map(([role, label]) => ({
            name: ZWS,
            value: `${labelled(emojis, roleUiEmojiName(role), label)} **${seats[role]}**${targetText(event, role)}`,
            inline: true,
        })),
        spacer(false),
    ];

    const tail = [];
    const setupText = approvedSetupText(event);
    if (setupText) tail.push({ name: head("signed", "Setup"), value: setupText, inline: false });
    const base = baseUrl();
    const id = encodeURIComponent(event.id);
    const links = [];
    if (base) links.push(`[Web](${base}/signups?event=${id})`);
    if (base && setupText) links.push(`[Setup](${base}/raids/detail?event=${id}&tab=setup)`);
    if (icsUrl) links.push(`[Kalender](${icsUrl})`);
    if (links.length) tail.push({ name: ZWS, value: links.join("  ·  "), inline: false });

    const title = phase === "cancelled" ? `Abgesagt: ${event.title || "Raid"}` : (event.title || "Raid");
    const embed = {
        title: clip(title, LIMITS.title),
        color: phase === "cancelled" ? CANCELLED_COLOR : embedAccentColor,
        fields: [],
    };
    const text = clip(desc.join("\n"), LIMITS.description);
    if (text) embed.description = text;
    // Shorten the blocks until the whole embed fits Discord's 6000 characters.
    for (let maxLines = 40; maxLines >= 1; maxLines -= maxLines > 10 ? 5 : 1) {
        embed.fields = fitFields([...headFields, ...totals, ...rosterFields(entries, numbers, emojis, maxLines), ...tail]);
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
    return buildEventMessage(event, listSignups(event.id), { emojis: appEmojiMap() });
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
    rosterCounts, messagePhase, signupNumbers, embedLength, blockValue, payloadHash,
    buildEventMessage, approvedSetupText, sweepEventMessages, redrawEventMessage,
    postEventMessage, refreshEventMessage, startEventMessageSync,
};
