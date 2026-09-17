// The bot's own signup message for an EventHelper event, in the event's channel —
// the counterpart of Raid-Helper's widget (#254, rebuilt in #287).
//
// One embed: title and description, a head (leader, count against the size,
// deadline, date, time, relative), the role totals against the plan, then the
// roster — a "Tank" block first, one block per class after it (spec icon ·
// signup number · name, three inline columns), one line each for Spät /
// Vielleicht / Bank / Abgemeldet — the approved setup and the links.
//
// Every character of a signup is listed where its own status puts it: a raider
// signed up with a healer and a tank shows up in both blocks, under the same
// number, and a first character on "Spät" sits in the Spät line while the
// second stays in its class block. The head's count and the role totals are
// per person (a raider takes one seat — the setup places one character, too).
//
// Icons are the bot's application emojis (appEmojis.js): WoW icons for specs,
// classes and roles, flat grey line icons (`eh_ui_*`) for the head, the
// statuses and the buttons. Without them the icons are simply left out and the
// labels carry the message — no colourful unicode stand-ins.
//
// Below it the signup buttons `event-btn:<eventId>:<action>` — Anmelden ·
// Klasse wählen · Absagen, then Spät · Vielleicht · Bank; their handler
// (commands/signup/eventButton.js) answers only the member. After the deadline
// only Spät · Absagen, a closed signup only Absagen, nothing once the raid
// started or for a cancelled event. Messages posted earlier carry the select
// `event-join:<eventId>` (#287) or the button `event-signup:<eventId>` (#254);
// both handlers keep working until the message is redrawn with the buttons.
//
// Posted when the event is created (eventCreate.js) and edited whenever its
// roster changes (signupStore.onSignupsChanged → startEventMessageSync), and
// once more when the deadline or the start passes (the sweep). Where the
// message sits is remembered on the event (eventStore.setEventMessage).
//
// Nothing personal goes in beyond the character names the raiders signed up
// with — the names the channel would see in Raid-Helper, too.
const { embedAccentColor, publicBaseUrl } = require("../config/variables");
const { getEvent, setEventMessage, listEvents } = require("./eventStore");
const { listSignups, onSignupsChanged } = require("./signupStore");
const discord = require("./discord");
// The counting rule lives in the signup service, so the page and the message agree.
const { rosterCounts, allowedStatuses, signupWindow } = require("./signupService");
const { buildClasses } = require("../config/gameVersions/classes");
const {
    appEmojiMap, loadAppEmojis, emojiText, emojiOption,
    specEmojiName, classEmojiName, roleEmojiName, statusEmojiName, uiEmojiName,
} = require("./appEmojis");
const { migrateSignup } = require("./signupCharacters");

// The old button id — messages posted before #287 carry it and keep working.
const SIGNUP_BUTTON_PREFIX = "event-signup";
// The select of #287 — messages posted before the buttons carry it and keep working.
const JOIN_SELECT_PREFIX = "event-join";
// The signup buttons: `event-btn:<eventId>:<action>`.
const BUTTON_PREFIX = "event-btn";
const BUTTON_ACTIONS = ["join", "class", "absence", "late", "tentative", "bench"];
const EDIT_DEBOUNCE_MS = 2000;
const SWEEP_MS = 5 * 60 * 1000;
const CANCELLED_COLOR = 0xe0524f;

// Discord's embed limits.
const LIMITS = { title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, total: 6000 };

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
const ROLE_TOTALS = [["tank", "Tanks"], ["healer", "Heiler"], ["melee", "Nahkampf"], ["ranged", "Fernkampf"]];

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

const baseUrl = () => String(publicBaseUrl || "").replace(/\/+$/, "");
const clip = (text, max) => {
    const s = String(text || "");
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
/** A name as plain text — no bold, links or mentions sneaking in through markdown. */
const escapeMd = (text) => String(text || "").replace(/([\\*_~`|>[\]()])/g, "\\$1").replace(/@/g, "@\u200b");

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

/** Lines as one field value: at most `maxLines` lines and 1024 characters, "+N weitere" for the rest. */
function blockValue(lines, maxLines) {
    const out = [];
    let length = 0;
    for (let i = 0; i < lines.length; i++) {
        const after = lines.length - i - 1;
        const reserve = after ? `\n+${after} weitere`.length : 0;
        const next = length + (out.length ? 1 : 0) + lines[i].length;
        if (out.length >= maxLines || next + reserve > LIMITS.fieldValue) {
            out.push(`+${lines.length - i} weitere`);
            break;
        }
        out.push(lines[i]);
        length = next;
    }
    return out.join("\n") || "​";
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

/** The roster fields — Tank block, class blocks, the other statuses — with at most `maxLines` per block. */
function rosterFields(entries, numbers, emojis, maxLines) {
    const numberOf = (e) => numbers.get(String(e.userId));
    const byNumber = (a, b) => numberOf(a) - numberOf(b) || a.index - b.index;
    const signed = entries.filter((e) => e.status === "signed");
    const fields = [];
    const block = (name, list) => {
        const sorted = list.slice().sort(byNumber);
        fields.push({
            name: clip(`${name} (${sorted.length})`, LIMITS.fieldName),
            value: blockValue(sorted.map((e) => rosterLine(e, numberOf(e), emojis)), maxLines),
            inline: true,
        });
    };
    const tanks = signed.filter((e) => e.role === "tank");
    if (tanks.length) block(labelled(emojis, roleEmojiName("tank"), "Tank"), tanks);
    for (const cls of CLASSES) {
        const members = signed.filter((e) => e.role !== "tank" && (SPEC_BY_KEY.get(e.spec) || {}).classId === cls.id);
        if (members.length) block(labelled(emojis, classEmojiName(cls.id), cls.label), members);
    }
    // Signed without a known spec (the service does not let that happen) is still shown.
    const unknown = signed.filter((e) => e.role !== "tank" && !SPEC_BY_KEY.get(e.spec));
    if (unknown.length) block("Ohne Spec", unknown);

    const other = [];
    for (const [status, label] of OTHER_LINES) {
        const list = entries.filter((e) => e.status === status).sort(byNumber);
        if (!list.length) continue;
        const shown = list.slice(0, maxLines * 2).map((e) => `\`${numberOf(e)}\` ${nameOf(e)}`);
        const more = list.length - shown.length;
        other.push(`${labelled(emojis, statusEmojiName(status), label)} (${list.length}): ${shown.join(", ")}${more ? ` +${more} weitere` : ""}`);
    }
    if (other.length) fields.push({ name: "​", value: clip(other.join("\n"), LIMITS.fieldValue), inline: false });
    return fields;
}

const BUTTON_STYLE = { primary: 1, secondary: 2, success: 3, danger: 4 };
const BUTTONS = {
    join: { label: "Anmelden", style: BUTTON_STYLE.success, icon: "signed" },
    class: { label: "Klasse wählen", style: BUTTON_STYLE.secondary, icon: "class" },
    absence: { label: "Absagen", style: BUTTON_STYLE.danger, icon: "absence" },
    late: { label: "Spät", style: BUTTON_STYLE.secondary, icon: "late" },
    tentative: { label: "Vielleicht", style: BUTTON_STYLE.secondary, icon: "tentative" },
    bench: { label: "Bank", style: BUTTON_STYLE.secondary, icon: "bench" },
};

/**
 * Which buttons a phase offers, as rows of actions: before the deadline
 * Anmelden · Klasse wählen · Absagen and Spät · Vielleicht · Bank; after it
 * Spät · Absagen; a closed signup only Absagen; nothing once the raid started
 * or the event was cancelled.
 */
function buttonRows(event, phase, now = Date.now()) {
    if (phase === "open") {
        const allowed = allowedStatuses(event, { now });
        const row1 = ["join", "class", "absence"].filter((a) => a === "absence" || allowed.includes("signed"));
        const row2 = ["late", "tentative", "bench"].filter((a) => allowed.includes(a));
        return [row1, row2].filter((r) => r.length);
    }
    if (phase === "deadline") return [["late", "absence"]];
    if (phase === "closed") return event && event.signupsClosed ? [["absence"]] : [];
    return [];
}

/** The signup buttons of a phase as component rows. */
function buttonComponents(event, phase, emojis, now) {
    return buttonRows(event, phase, now).map((row) => ({
        type: 1,
        components: row.map((action) => {
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

    const headFields = [
        { name: head("leader", "Leitung"), value: event.leaderId ? `<@${event.leaderId}>` : "–", inline: true },
        { name: head("signups", "Angemeldet"), value: `**${c.attending}**${event.size ? ` / ${event.size}` : ""}`, inline: true },
        { name: head("deadline", "Anmeldeschluss"), value: deadline ? `<t:${deadline}:f>` : "–", inline: true },
        { name: head("date", "Datum"), value: start ? `<t:${start}:D>` : "–", inline: true },
        { name: head("time", "Uhrzeit"), value: start ? `<t:${start}:t>` : "–", inline: true },
        { name: head("start", "Start"), value: start ? `<t:${start}:R>` : "–", inline: true },
    ];
    // Who takes a seat, per role and per person (rosterCounts folds melee and ranged into dps).
    const seats = { tank: c.tank, healer: c.healer, melee: 0, ranged: 0 };
    for (const s of list) {
        if (["signed", "late"].includes(s.status || "signed") && (s.role === "melee" || s.role === "ranged")) seats[s.role] += 1;
    }
    const totals = {
        name: "​",
        value: ROLE_TOTALS
            .map(([role, label]) => `${labelled(emojis, roleEmojiName(role), label)} **${seats[role]}**${targetText(event, role)}`)
            .join("  ·  "),
        inline: false,
    };

    const tail = [];
    const setupText = approvedSetupText(event);
    if (setupText) tail.push({ name: head("signed", "Setup"), value: setupText, inline: false });
    const base = baseUrl();
    const id = encodeURIComponent(event.id);
    const links = [];
    if (base) links.push(`[Web](${base}/signups?event=${id})`);
    if (base && setupText) links.push(`[Setup](${base}/raids/detail?event=${id}&tab=setup)`);
    if (icsUrl) links.push(`[Kalender](${icsUrl})`);
    if (links.length) tail.push({ name: "​", value: links.join(" | "), inline: false });

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
        embed.fields = [...headFields, totals, ...rosterFields(entries, numbers, emojis, maxLines), ...tail].slice(0, LIMITS.fields);
        if (embedLength(embed) <= LIMITS.total) break;
    }
    return { content: "", embeds: [embed], components: buttonComponents(event, phase, emojis, now) };
}

async function textChannel(channelId) {
    const client = discord.getClient();
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("Channel nicht gefunden oder kein Textkanal.");
    return channel;
}

/** The payload with the application emojis (read once per process; text icons without them). */
async function payloadFor(event) {
    await loadAppEmojis(discord.getClient());
    return buildEventMessage(event, listSignups(event.id), { emojis: appEmojiMap() });
}

/**
 * Post the event's message into its channel and remember where it sits.
 * @returns {Promise<{ channelId: string, messageId: string }>}
 */
async function postEventMessage(eventId) {
    const event = getEvent(eventId);
    if (!event) throw new Error("Event nicht gefunden.");
    const channel = await textChannel(event.channelId);
    const posted = await channel.send(await payloadFor(event));
    const where = { channelId: channel.id, messageId: posted.id };
    setEventMessage(event.id, where);
    return where;
}

/**
 * Bring the event's message up to date: edit it in place, or post it anew when
 * there is none yet or it was deleted in Discord.
 * @returns {Promise<{ channelId: string, messageId: string, reposted: boolean }|null>} null for an unknown event
 */
async function refreshEventMessage(eventId) {
    const event = getEvent(eventId);
    if (!event) return null;
    if (event.message) {
        try {
            const channel = await textChannel(event.message.channelId);
            const message = await channel.messages.fetch(event.message.messageId);
            await message.edit(await payloadFor(event));
            return { ...event.message, reposted: false };
        } catch (e) {
            // A message deleted by hand is re-posted; anything else is reported.
            if (!(e && (e.code === 10008 || /unknown message/i.test(e.message || "")))) throw e;
        }
    }
    const where = await postEventMessage(event.id);
    return { ...where, reposted: true };
}

// The phase each message was last drawn in — the sweep redraws a message once
// its deadline or start has passed since (the select has to change).
const drawnPhase = new Map();
// After a restart nothing is known: redraw what changed phase within this window.
const BOOT_WINDOW_S = 12 * 3600;

/**
 * The events whose message has to be redrawn because the deadline or the start
 * passed. Pure over the list; `drawn` (id → phase) is updated for the rest.
 */
function eventsToRedraw(events, drawn, now = Date.now()) {
    const nowSec = Math.floor(now / 1000);
    const recent = (t) => !!t && t <= nowSec && nowSec - t <= BOOT_WINDOW_S;
    const out = [];
    for (const event of events || []) {
        if (!event || !event.id || !event.message) continue;
        const phase = messagePhase(event, now);
        const known = drawn.get(event.id);
        if (known !== undefined) {
            if (known !== phase) out.push(event.id);
            continue;
        }
        if ((phase === "started" && recent(Number(event.startTime))) || (phase === "deadline" && recent(Number(event.signupDeadline)))) {
            out.push(event.id);
        } else {
            drawn.set(event.id, phase);
        }
    }
    return out;
}

async function redrawEvent(eventId) {
    await refreshEventMessage(eventId);
    const event = getEvent(eventId);
    if (event) drawnPhase.set(event.id, messagePhase(event));
}

/** One sweep over the events of the last two days and the coming ones. */
async function sweepEventMessages(now = Date.now()) {
    const since = Math.floor(now / 1000) - 2 * 86400;
    for (const id of eventsToRedraw(listEvents("", { sinceSeconds: since }), drawnPhase, now)) {
        try {
            await redrawEvent(id);
        } catch (e) {
            console.error(`[eventMessage] ${id}:`, e.message);
        }
    }
}

const pending = new Map();
let unsubscribe = null;

/**
 * Keep every event message current: a roster change schedules one edit per
 * event, a burst of changes within `debounceMs` collapses into one; a sweep
 * every `sweepMs` redraws messages whose deadline or start just passed.
 * Idempotent; returns the stop function.
 */
function startEventMessageSync({ debounceMs = EDIT_DEBOUNCE_MS, sweepMs = SWEEP_MS } = {}) {
    if (unsubscribe) return unsubscribe;
    const off = onSignupsChanged((eventId) => {
        clearTimeout(pending.get(eventId));
        const timer = setTimeout(() => {
            pending.delete(eventId);
            redrawEvent(eventId).catch((e) => console.error(`[eventMessage] ${eventId}:`, e.message));
        }, debounceMs);
        if (timer.unref) timer.unref();
        pending.set(eventId, timer);
    });
    const sweep = sweepMs > 0
        ? setInterval(() => sweepEventMessages().catch((e) => console.error("[eventMessage] sweep:", e.message)), sweepMs)
        : null;
    if (sweep && sweep.unref) sweep.unref();
    unsubscribe = () => {
        off();
        if (sweep) clearInterval(sweep);
        for (const t of pending.values()) clearTimeout(t);
        pending.clear();
        unsubscribe = null;
    };
    return unsubscribe;
}

module.exports = {
    SIGNUP_BUTTON_PREFIX, JOIN_SELECT_PREFIX, BUTTON_PREFIX, BUTTON_ACTIONS, STATUS_OPTIONS, LIMITS,
    signupButtonId, joinSelectId, buttonId, buttonRows, rosterEntries,
    rosterCounts, messagePhase, signupNumbers, embedLength, blockValue,
    buildEventMessage, approvedSetupText, eventsToRedraw, sweepEventMessages,
    postEventMessage, refreshEventMessage, startEventMessageSync,
};
