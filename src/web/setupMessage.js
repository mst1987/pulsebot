// The approved setup of an own event in its channel, and optionally per DM (#290).
//
// ⚠️ Only the approved snapshot (setupEditor.approvedSetupOf) ever leaves the
// editor: a draft is never posted and never sent. A draft changed after an
// approval keeps the message on the approved lineup until the next approval.
//
// The message is its own post beside the signup message: groups 1–5 as inline
// blocks (spec icon · name), the bench in one line, a line of role totals. It is
// posted on the first approval and **edited** on every later one — where it sits
// is remembered on the event (`event.setupPost`). A message deleted in Discord is
// posted anew; a cancelled event gets its message marked ("Abgesagt"), never a
// new one.
//
// DMs are a switch per category (`config.categorySetupDms`, off by default):
// placed raiders read "Du bist in Gruppe 2 als Heiler (Zibbo · Heilig)", the
// bench "Diesmal Bank …" with the proposal's reasons. A raider is told once per
// placement — `setupPost.told[userId]` keeps what they were told, so a new
// approval only writes to those whose place changed, and a failed DM is tried
// again on the next run. DMs go out one after the other with a pause between
// them; the outcome (sent, failed with the reason) is stored for the editor.
//
// The bar carries the **same colour as the signup message** (#307,
// embedLook.embedColor): the two posts sit in one channel and belong together.
// The picture stays with the signup message — two copies of the same boss icon
// under each other would only take room.
//
// Nothing here throws at a caller: Discord errors come back as `{ code, error }`
// and are stored, so an offline bot never fails an approval.
const { publicBaseUrl } = require("../config/variables");
const { embedColor } = require("./embedLook");
const eventStore = require("./eventStore");
const { getConfig } = require("./settingsStore");
const discord = require("./discord");
const { buildClasses } = require("../config/gameVersions/classes");
const {
    appEmojiMap, loadAppEmojis, emojiText, specEmojiName, roleEmojiName, statusEmojiName, uiEmojiName,
} = require("./appEmojis");

const LIMITS = { title: 256, description: 4096, fields: 25, fieldValue: 1024, total: 6000 };
const CANCELLED_COLOR = 0xe0524f;
// A pause between two DMs — Discord's DM limit is generous, a burst is not.
const DM_DELAY_MS = 1200;
const ROLE_LABEL = { tank: "Tank", healer: "Heiler", melee: "Nahkampf", ranged: "Fernkampf" };
const ROLE_ORDER = ["tank", "healer", "melee", "ranged"];
// Reasons that name other raiders (wishes) stay out of a DM.
const PRIVATE_REASON = /wunsch/i;

const CLASSES = buildClasses();
const SPEC_BY_KEY = new Map(CLASSES.flatMap((c) => c.specs.map((s) => [s.key, s])));

const str = (v) => String(v === null || v === undefined ? "" : v).trim();
const clip = (text, max) => {
    const s = String(text || "");
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
/** A name as plain text — no bold, links or mentions through markdown. */
const escapeMd = (text) => String(text || "").replace(/([\\*_~`|>[\]()])/g, "\\$1").replace(/@/g, "@\u200b");
const baseUrl = () => String(publicBaseUrl || "").replace(/\/+$/, "");
const specLabel = (key) => (SPEC_BY_KEY.get(key) || {}).label || "";
const nameOf = (p) => escapeMd(p.character) || `<@${p.userId}>`;

function approvedOf(event) {
    // Lazily: setupEditor pulls in the proposal's inputs.
    const { approvedSetupOf } = require("./setupEditor");
    return approvedSetupOf(event);
}

/** Characters Discord counts against the 6000 of an embed. */
function embedLength(embed) {
    return String(embed.title || "").length
        + String(embed.description || "").length
        + String((embed.footer && embed.footer.text) || "").length
        + (embed.fields || []).reduce((n, f) => n + String(f.name).length + String(f.value).length, 0);
}

/** "<spec icon> **Name**", without icons "**Name** · Heilig". */
function personText(p, emojis, { icons = true, bold = true } = {}) {
    const icon = icons ? emojiText(emojis, specEmojiName(p.spec)) : "";
    const name = bold ? `**${nameOf(p)}**` : nameOf(p);
    if (icon) return `${icon} ${name}`;
    const label = specLabel(p.spec);
    return `${name}${label ? ` · ${label}` : ""}`;
}

/** Items joined into one field value of at most 1024 characters, "+N weitere" for the rest. */
function joinClipped(items, sep) {
    let out = "";
    for (let i = 0; i < items.length; i++) {
        const rest = items.length - i - 1;
        const next = out ? `${out}${sep}${items[i]}` : items[i];
        const reserve = rest ? ` +${rest} weitere`.length : 0;
        if (next.length + reserve > LIMITS.fieldValue) return `${out} +${items.length - i} weitere`.trim();
        out = next;
    }
    return out || "\u200b";
}

/** Who plays which role in the approved lineup (groups only). */
function roleCounts(approved) {
    const counts = { tank: 0, healer: 0, melee: 0, ranged: 0 };
    for (const g of approved.groups || []) {
        for (const s of g.slots || []) if (counts[s.role] !== undefined) counts[s.role] += 1;
    }
    return counts;
}

/**
 * The setup message — pure, plain API JSON. `null` without an approved lineup:
 * a draft is never turned into a message.
 * @param {object} event     an eventStore event (a cancelled one is marked)
 * @param {object|null} approved the approved snapshot (setupEditor.approvedSetupOf)
 * @param {{ emojis?: object }} opts `emojis`: name → { id, name, animated }; none = text
 */
function buildSetupMessage(event, approved, { emojis = {} } = {}) {
    if (!event || !approved || !Array.isArray(approved.groups)) return null;
    const cancelled = event.status === "cancelled";
    const title = clip(`${cancelled ? "Abgesagt: " : ""}Setup · ${event.title || "Raid"}`, LIMITS.title);
    const start = Number(event.startTime) || 0;

    if (cancelled) {
        const reason = (event.cancel && event.cancel.reason) || "";
        return {
            content: "",
            embeds: [{
                title,
                color: CANCELLED_COLOR,
                description: `${[emojiText(emojis, uiEmojiName("absence")), "**Abgesagt**"].filter(Boolean).join(" ")}${reason ? ` – ${escapeMd(clip(reason, 300))}` : ""}\nDas Setup entfällt.`,
            }],
            components: [],
        };
    }

    const counts = roleCounts(approved);
    const totals = ROLE_ORDER
        .filter((r) => counts[r])
        // without the role icon the role's name: "Tank 1" — no colourful unicode stand-ins
        .map((r) => `${emojiText(emojis, roleEmojiName(r), ROLE_LABEL[r])} ${counts[r]}`)
        .join("  ·  ");
    const description = [start ? `<t:${start}:F>` : "", totals].filter(Boolean).join("\n");
    const groups = approved.groups.filter((g) => (g.slots || []).length).sort((a, b) => a.index - b.index);
    const bench = approved.bench || [];
    const base = baseUrl();
    const link = base ? `[Im Web ansehen](${base}/signups?event=${encodeURIComponent(event.id)})` : "";

    // Tried in order until the embed fits: icons everywhere, a plain bench, plain groups too.
    const variants = [{ groupIcons: true, benchIcons: true }, { groupIcons: true, benchIcons: false }, { groupIcons: false, benchIcons: false }];
    let embed = null;
    for (const v of variants) {
        const fields = groups.map((g) => ({
            name: `Gruppe ${g.index}`,
            value: clip(g.slots.map((s) => personText(s, emojis, { icons: v.groupIcons })).join("\n"), LIMITS.fieldValue),
            inline: true,
        }));
        if (bench.length) {
            fields.push({
                name: `${[emojiText(emojis, statusEmojiName("bench")), "Bank"].filter(Boolean).join(" ")} (${bench.length})`,
                value: joinClipped(bench.map((b) => personText(b, emojis, { icons: v.benchIcons, bold: false })), " · "),
                inline: false,
            });
        }
        if (link) fields.push({ name: "\u200b", value: link, inline: false });
        embed = {
            title,
            color: embedColor(event),
            description: clip(description, LIMITS.description),
            fields: fields.slice(0, LIMITS.fields),
            footer: { text: `Freigegebenes Setup · Stand ${approved.version || 1}` },
        };
        if (!embed.description) delete embed.description;
        if (embedLength(embed) <= LIMITS.total) break;
    }
    if (approved.approvedAt) embed.timestamp = new Date(Number(approved.approvedAt)).toISOString();
    return { content: "", embeds: [embed], components: [] };
}

// ---- DMs --------------------------------------------------------------------

/** Every raider of the approved lineup with where they stand. */
function placementsOf(approved) {
    if (!approved) return [];
    const out = [];
    for (const g of approved.groups || []) {
        for (const s of g.slots || []) out.push({ ...s, group: g.index, bench: false });
    }
    for (const b of approved.bench || []) out.push({ ...b, group: 0, bench: true });
    return out;
}

/** What a raider is told — a new DM goes out only when this changes. */
function placementSignature(p) {
    return p.bench ? `bench/${p.spec}` : `g${p.group}/${p.spec}/${p.role}`;
}

/** Whether DMs are switched on for the event's category. */
function dmsEnabled(event, config = getConfig()) {
    return !!(event && event.categoryId && ((config && config.categorySetupDms) || {})[event.categoryId] === true);
}

/** The bench reasons of the proposal — only while the stored setup is the approved version. */
function benchReasons(event, userId) {
    const setup = event && event.setup;
    if (!setup || !setup.approved || Number(setup.version) !== Number(setup.approved.version)) return [];
    const hit = (setup.bench || []).find((b) => String(b.userId) === String(userId));
    return ((hit && hit.reasons) || []).filter((r) => r && !PRIVATE_REASON.test(r)).slice(0, 2);
}

/** Whether the event gives priority to who sat on the bench (the editor's switch, else the event's flag). */
function fairnessOn(event) {
    const options = (event && event.setup && event.setup.options) || {};
    return typeof options.fairness === "boolean" ? options.fairness : !!(event && event.fairness);
}

/**
 * The DM for one raider — pure.
 * "Du bist in **Gruppe 2** als **Heiler** (Zibbo · Heilig)." resp. the bench.
 */
function buildSetupDm(event, placement, { messageUrl = "", reasons = [], fairness = false } = {}) {
    const start = Number(event.startTime) || 0;
    const who = [escapeMd(placement.character), specLabel(placement.spec)].filter(Boolean).join(" · ");
    const lines = [`**Setup für ${escapeMd(event.title || "Raid")}**${start ? ` · <t:${start}:F>` : ""}`];
    if (placement.bench) {
        lines.push(`Diesmal **Bank**${who ? ` (${who})` : ""}${fairness ? " – nächstes Mal hast du Vorrang." : "."}`);
        // The proposal's own German wording (reasons.js), no user input.
        if (reasons.length) lines.push(`Grund: ${reasons.join(" · ")}`);
    } else {
        lines.push(`Du bist in **Gruppe ${placement.group}** als **${ROLE_LABEL[placement.role] || "Raider"}**${who ? ` (${who})` : ""}.`);
    }
    if (messageUrl) lines.push(`[Zum Setup](${messageUrl})`);
    return { content: clip(lines.join("\n"), 2000) };
}

function messageUrlOf(event) {
    const post = event && event.setupPost;
    return post && post.messageId && event.guildId
        ? `https://discord.com/channels/${event.guildId}/${post.channelId}/${post.messageId}`
        : "";
}

const running = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send the approved setup per DM to everyone whose placement they were not told
 * yet. Only with the category's switch on, only an approved setup, never for a
 * cancelled event; one run per event at a time.
 * @returns {Promise<{ skipped?: string, sent?: number, failed?: object[], unchanged?: number }>}
 */
async function sendSetupDms(eventId, { config = getConfig(), delayMs = DM_DELAY_MS, now = () => Date.now() } = {}) {
    const event = eventStore.getEvent(eventId);
    if (!event) return { skipped: "not_found" };
    const approved = approvedOf(event);
    if (!approved) return { skipped: "no_approved_setup" };
    if (event.status === "cancelled") return { skipped: "cancelled" };
    if (!dmsEnabled(event, config)) return { skipped: "off" };
    if (running.has(event.id)) return { skipped: "running" };

    const told = { ...((event.setupPost && event.setupPost.told) || {}) };
    const people = placementsOf(approved);
    const todo = people.filter((p) => told[p.userId] !== placementSignature(p));
    const dms = { version: approved.version, status: "running", startedAt: now(), at: 0, total: todo.length, sent: 0, failed: [], unchanged: people.length - todo.length };
    if (!todo.length) {
        eventStore.setEventSetupPost(event.id, { dms: { ...dms, status: "done", at: now() } });
        return { sent: 0, failed: [], unchanged: dms.unchanged };
    }
    running.add(event.id);
    eventStore.setEventSetupPost(event.id, { dms });
    try {
        const fairness = fairnessOn(event);
        const messageUrl = messageUrlOf(event);
        for (let i = 0; i < todo.length; i++) {
            const p = todo[i];
            if (i && delayMs > 0) await sleep(delayMs);
            const payload = buildSetupDm(event, p, { messageUrl, fairness, reasons: p.bench ? benchReasons(event, p.userId) : [] });
            let result;
            try {
                result = await discord.sendDirectMessage(p.userId, payload);
            } catch (e) {
                result = { ok: false, error: (e && e.message) || "Bot nicht verbunden." };
            }
            if (result && result.ok) {
                told[p.userId] = placementSignature(p);
                dms.sent += 1;
            } else {
                dms.failed.push({ userId: String(p.userId), character: p.character || "", error: clip((result && result.error) || "unbekannt", 200) });
            }
            eventStore.setEventSetupPost(event.id, { dms, told });
        }
    } finally {
        dms.status = "done";
        dms.at = now();
        eventStore.setEventSetupPost(event.id, { dms, told });
        running.delete(event.id);
    }
    return { sent: dms.sent, failed: dms.failed, unchanged: dms.unchanged };
}

// ---- the message in Discord ---------------------------------------------------

async function textChannel(channelId) {
    const client = discord.getClient();
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("Kanal nicht gefunden oder kein Textkanal.");
    return channel;
}

const isUnknownMessage = (e) => !!(e && (e.code === 10008 || /unknown message/i.test(e.message || "")));

async function payloadFor(event, approved) {
    await loadAppEmojis(discord.getClient());
    return buildSetupMessage(event, approved, { emojis: appEmojiMap() });
}

/**
 * Post the approved setup into the event's channel, or edit the message that is
 * already there. A draft is refused (`no_approved_setup`), a cancelled event
 * only gets an existing message marked (`cancelled` without one).
 * @returns {Promise<{ action?: "posted"|"edited", code?: string, error?: string }>}
 */
async function postOrEditSetupMessage(eventId, { userId = "", now = Date.now() } = {}) {
    const event = eventStore.getEvent(eventId);
    if (!event) return { code: "not_found", error: "Event nicht gefunden." };
    const approved = approvedOf(event);
    if (!approved) return { code: "no_approved_setup", error: "Es gibt noch kein freigegebenes Setup." };
    const post = event.setupPost || {};
    const cancelled = event.status === "cancelled";
    if (cancelled && !post.messageId) return { code: "cancelled", error: "Das Event ist abgesagt." };
    if (!event.channelId && !post.channelId) return { code: "no_channel", error: "Das Event hat keinen Kanal." };

    try {
        const payload = await payloadFor(event, approved);
        if (post.messageId) {
            try {
                const channel = await textChannel(post.channelId);
                const message = await channel.messages.fetch(post.messageId);
                await message.edit(payload);
                eventStore.setEventSetupPost(event.id, { version: approved.version, editedAt: now, editedBy: str(userId), error: "", errorAt: 0 });
                return { action: "edited" };
            } catch (e) {
                // A message deleted by hand is posted anew — unless the event is cancelled.
                if (!isUnknownMessage(e) || cancelled) throw e;
            }
        }
        const channel = await textChannel(event.channelId);
        const sent = await channel.send(payload);
        eventStore.setEventSetupPost(event.id, {
            channelId: String(channel.id), messageId: String(sent.id), version: approved.version,
            postedAt: now, postedBy: str(userId), editedAt: 0, editedBy: "", error: "", errorAt: 0,
        });
        return { action: "posted" };
    } catch (e) {
        const error = clip((e && e.message) || "Discord hat nicht geantwortet.", 300);
        eventStore.setEventSetupPost(event.id, { error, errorAt: now });
        return { code: "discord", error };
    }
}

/**
 * After an approval (or the editor's "Setup posten"): the message first, so the
 * DMs can link to it, then the DMs in the background. Returns once the message
 * is done; `dms` is the running promise (null when there is nothing to send).
 */
async function publishSetup(eventId, { userId = "", now = Date.now(), config = getConfig(), delayMs } = {}) {
    const post = await postOrEditSetupMessage(eventId, { userId, now });
    const event = eventStore.getEvent(eventId);
    let dms = null;
    if (event && !post.code && dmsEnabled(event, config)) {
        dms = sendSetupDms(eventId, { config, ...(delayMs !== undefined ? { delayMs } : {}) })
            .catch((e) => ({ skipped: "error", error: e && e.message }));
    }
    return { post, dms };
}

/** Bring an already posted setup message up to date (a cancellation, its reversal). Never posts a new one. */
async function refreshSetupMessage(eventId) {
    const event = eventStore.getEvent(eventId);
    if (!event || !event.setupPost || !event.setupPost.messageId) return null;
    const result = await postOrEditSetupMessage(eventId);
    return result.code ? result.error : null;
}

/**
 * What the editor says about posting — before the approval what *will* happen,
 * after it what did. Pure over event and config.
 */
function publishView(event, { config = getConfig(), channelName = "" } = {}) {
    const post = (event && event.setupPost) || {};
    const approved = approvedOf(event);
    const setup = event && event.setup;
    // Before an approval the draft is what will be sent; afterwards the approved lineup.
    const lineup = setup && setup.status !== "approved" ? setup : approved;
    const people = placementsOf(lineup);
    const told = post.told || {};
    return {
        channelId: post.channelId || (event && event.channelId) || "",
        channelName: channelName || (event && event.channelName) || "",
        cancelled: !!(event && event.status === "cancelled"),
        dmsEnabled: dmsEnabled(event, config),
        recipients: people.length,
        pendingDms: people.filter((p) => told[p.userId] !== placementSignature(p)).length,
        posted: post.messageId ? {
            messageUrl: messageUrlOf(event),
            version: post.version || 0,
            postedAt: post.postedAt || 0,
            editedAt: post.editedAt || 0,
        } : null,
        outdated: !!(post.messageId && approved && Number(post.version) !== Number(approved.version)),
        error: post.error || "",
        errorAt: post.errorAt || 0,
        dms: post.dms ? {
            status: post.dms.status || "done",
            version: post.dms.version || 0,
            at: post.dms.at || 0,
            total: post.dms.total || 0,
            sent: post.dms.sent || 0,
            failed: (post.dms.failed || []).map((f) => ({ userId: f.userId, character: f.character, error: f.error })),
            unchanged: post.dms.unchanged || 0,
        } : null,
    };
}

function _resetForTests() {
    running.clear();
}

module.exports = {
    LIMITS, DM_DELAY_MS,
    buildSetupMessage, buildSetupDm, embedLength, placementsOf, placementSignature, dmsEnabled, benchReasons,
    postOrEditSetupMessage, sendSetupDms, publishSetup, refreshSetupMessage, publishView, _resetForTests,
};
