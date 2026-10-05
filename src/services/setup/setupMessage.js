// The approved setup of an own event in its channel, and optionally per DM (#290).
//
// ⚠️ Only the approved snapshot (setupEditor.approvedSetupOf) ever leaves the
// editor: a draft is never posted and never sent. Once the message is posted, a
// change in the editor is approved at once (setupEditor.postedLive) and the
// message follows (`refreshLiveSetup`, no ping, no DMs); before the first post
// a changed draft waits for the approval.
//
// The message is its own post beside the signup message: groups 1–5 as inline
// blocks (spec icon · name), the bench in one line — only when the orga ticks
// "Bench mitposten" (#517, `setupPost.bench`, off by default; the pool of who
// signed up and was not placed is never posted) — a line of role totals. It is
// posted on the first approval and **edited** on every later one — where it sits
// is remembered on the event (`event.setupPost`). A message deleted in Discord is
// posted anew; a cancelled event gets its message marked ("Cancelled"), never a
// new one. The message is public, so it speaks the server language
// (services/discord/botLanguage.js `serverLang`, German by default).
//
// DMs are a switch per category (`config.categorySetupDms`, off by default):
// placed raiders get a card "Gruppe 2 als Heiler" (Zibbo · Heilig), the
// bench — only while it is posted (#517) — "Diesmal auf der Bank …" with the
// proposal's reasons — each in the raider's own language (`langOf`; the German
// reasons through utils/i18n/botText.js `serviceText`). A raider is told once per
// placement — `setupPost.told[userId]` keeps what they were told, so a new
// approval only writes to those whose place changed, and a failed DM is tried
// again on the next run. DMs go out one after the other with a pause between
// them; the outcome (sent, failed with the reason) is stored for the editor.
//
// Under the message sits one button, "Invite callen" (inviteCallBot.js): the
// orga pings groups 1–5 with "/w <Charakter> inv". A cancelled event has none.
//
// The bar carries the **same colour as the signup message** (#307,
// embedLook.embedColor): the two posts sit in one channel and belong together.
// The picture stays with the signup message — two copies of the same boss icon
// under each other would only take room.
//
// Nothing here throws at a caller: Discord errors come back as `{ code, error }`
// and are stored, so an offline bot never fails an approval.
const { ButtonBuilder, ButtonStyle } = require("discord.js");
const { card } = require("../../utils/discord/card");
const linkCheck = require("../discord/linkCheck");
const { embedColor } = require("../events/embedLook");
const eventStore = require("../../stores/eventStore");
const { getConfig } = require("../../stores/settingsStore");
const discord = require("../discord/discord");
const { buildClasses, ROLE_LABELS, ROLE_LABELS_EN } = require("../../config/gameVersions/classes");
const { tr, serviceText, specLabel: specLabelIn, normalizeLang } = require("../../utils/i18n/botText");
const { serverLang, langOf } = require("../discord/botLanguage");
const {
    appEmojiMap, loadAppEmojis, emojiText, specEmojiName, roleUiEmojiName, statusEmojiName, uiEmojiName,
    roleEmojiName, emojiStyleOf,
} = require("../discord/appEmojis");
const { str, clip } = require("../../utils/text");
const { approvedSetupOf, benchPosted, confirmationsFor, confirmButtonRow, inviteButtonRow, pingButtonRow } = require("./setupCore");
const { callSetupPing, refreshSetupPing } = require("./setupPing");

const LIMITS = { title: 256, description: 4096, fields: 25, fieldValue: 1024, total: 6000 };
const CANCELLED_COLOR = 0xe0524f;
// A pause between two DMs — Discord's DM limit is generous, a burst is not.
const DM_DELAY_MS = 1200;
const ROLE_ORDER = ["tank", "healer", "melee", "ranged"];
// Reasons that name other raiders (wishes) stay out of a DM.
const PRIVATE_REASON = /wunsch/i;

const CLASSES = buildClasses();
const SPEC_BY_KEY = new Map(CLASSES.flatMap((c) => c.specs.map((s) => [s.key, s])));

/** A name as plain text — no bold, links or mentions through markdown. */
const escapeMd = (text) => String(text || "").replace(/([\\*_~`|>[\]()])/g, "\\$1").replace(/@/g, "@\u200b");
const specLabel = (key, lang = "de") => specLabelIn(lang, SPEC_BY_KEY.get(key), "");
/** A role's name in the language ("Heiler" / "Healer"). */
const roleLabel = (role, lang = "de") => (normalizeLang(lang) === "en" ? ROLE_LABELS_EN : ROLE_LABELS)[role] || "";
const benchWord = (lang) => (normalizeLang(lang) === "en" ? "Bench" : "Bank");
const nameOf = (p) => escapeMd(p.character) || `<@${p.userId}>`;

/** Characters Discord counts against the 6000 of an embed. */
function embedLength(embed) {
    return String(embed.title || "").length
        + String(embed.description || "").length
        + String((embed.footer && embed.footer.text) || "").length
        + (embed.fields || []).reduce((n, f) => n + String(f.name).length + String(f.value).length, 0);
}

/** "<spec icon> **Name**", without icons "**Name** · Holy". */
function personText(p, emojis, { icons = true, bold = true, lang = "de" } = {}) {
    const icon = icons ? emojiText(emojis, specEmojiName(p.spec)) : "";
    const name = bold ? `**${nameOf(p)}**` : nameOf(p);
    if (icon) return `${icon} ${name}`;
    const label = specLabel(p.spec, lang);
    return `${name}${label ? ` · ${label}` : ""}`;
}

// The confirm mark's own column: green eh_ui_confirmed, red eh_ui_declined,
// or the fully transparent eh_ui_pending while a raider has not answered yet
// — always an emoji, so a name never shifts sideways once somebody clicks.
// Plain whitespace does not hold: Discord trims a leading run of it wherever
// a line starts (checked live), which is why "pending" has to be an image,
// not a character. Without app emojis at all (rare) the columns just do not
// line up, same as before this mark existed.
function markedPersonText(p, emojis, opts, confirmations) {
    const text = personText(p, emojis, opts);
    const status = confirmations[String(p.userId)] || "pending";
    const icon = emojiText(emojis, uiEmojiName(status));
    if (icon) return `${icon} ${text}`;
    const fallback = status === "confirmed" ? "✔ " : status === "declined" ? "✖ " : "";
    return `${fallback}${text}`;
}

/** Items joined into one field value of at most 1024 characters, "+N more" for the rest. */
function joinClipped(items, sep, lang = "de") {
    const more = (count) => tr(lang, "+{count} more", { count });
    let out = "";
    for (let i = 0; i < items.length; i++) {
        const rest = items.length - i - 1;
        const next = out ? `${out}${sep}${items[i]}` : items[i];
        const reserve = rest ? ` ${more(rest)}`.length : 0;
        if (next.length + reserve > LIMITS.fieldValue) return `${out} ${more(items.length - i)}`.trim();
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

/** Inline fields per row in a Discord embed (desktop): the group grid of the setup message. */
const GRID_COLUMNS = 3;

/**
 * The setup message — pure, plain API JSON. `null` without an approved lineup:
 * a draft is never turned into a message.
 * @param {object} event     an eventStore event (a cancelled one is marked)
 * @param {object|null} approved the approved snapshot (setupEditor.approvedSetupOf)
 * @param {{ emojis?: object, confirmations?: object, lang?: string }} opts `emojis`: name → { id, name,
 *   animated }; none = text. `confirmations`: userId → "confirmed" | "declined" (who stands
 *   in a group — setupCore.confirmationsFor; an answer stays through later changes).
 *   `lang`: the server language ("de" | "en", German by default).
 */
function buildSetupMessage(event, approved, { emojis = {}, confirmations = {}, bench: withBench = false, lang = "de" } = {}) {
    if (!event || !approved || !Array.isArray(approved.groups)) return null;
    const cancelled = event.status === "cancelled";
    const plainTitle = `Setup · ${event.title || "Raid"}`;
    const title = clip(cancelled ? tr(lang, "Cancelled: {title}", { title: plainTitle }) : plainTitle, LIMITS.title);
    const start = Number(event.startTime) || 0;

    if (cancelled) {
        const reason = (event.cancel && event.cancel.reason) || "";
        return {
            content: "",
            embeds: [{
                title,
                color: CANCELLED_COLOR,
                description: `${[emojiText(emojis, uiEmojiName("absence")), tr(lang, "**Cancelled**")].filter(Boolean).join(" ")}${reason ? ` – ${escapeMd(clip(reason, 300))}` : ""}\n${tr(lang, "The setup is off.")}`,
            }],
            components: [],
        };
    }

    const counts = roleCounts(approved);
    const totals = ROLE_ORDER
        .filter((r) => counts[r])
        // the role icons of the signup message in the event's emoji style, else
        // the flat ones (#303/#320); without them the role's name: "Tank 1"
        .map((r) => `${emojiText(emojis, roleEmojiName(r, emojiStyleOf(event.emojiStyle))) || emojiText(emojis, roleUiEmojiName(r), roleLabel(r, lang))} ${counts[r]}`)
        .join("     ·     ");
    // Short date + time + a relative countdown ("in 5 days"), like the signup
    // message's own date/time/start lines — the full weekday-and-all format
    // only bloated the header.
    const when = start ? `<t:${start}:D>     ·     <t:${start}:t>     ·     <t:${start}:R>` : "";
    // A blank line before the groups, so the header does not run straight into
    // "Group 1" — a bare empty line is trimmed off by Discord same as leading
    // whitespace, so it needs the same zero-width-space anchor.
    const descLines = [when, totals].filter(Boolean);
    if (descLines.length) descLines.push("\u200b");
    const description = descLines.join("\n");
    const groups = approved.groups.filter((g) => (g.slots || []).length).sort((a, b) => a.index - b.index);
    // the bench only when the orga chose to post it (#517)
    const bench = withBench ? (approved.bench || []) : [];
    // Straight to the comp: /e/<id>/comp sends the orga into the setup editor and
    // everyone else to the setup on the public event page (pageRoutes.eventComp).
    // Only with a real PUBLIC_BASE_URL (#537, linkCheck).
    const compUrl = linkCheck.webTarget("comp", event.id);
    const link = compUrl ? `[${tr(lang, "View the comp")}](${compUrl})` : "";

    // Tried in order until the embed fits: icons everywhere, a plain bench, plain groups too.
    const variants = [{ groupIcons: true, benchIcons: true }, { groupIcons: true, benchIcons: false }, { groupIcons: false, benchIcons: false }];
    let embed = null;
    for (const v of variants) {
        const fields = groups.map((g) => ({
            name: tr(lang, "Group {index}", { index: g.index }),
            value: clip(g.slots.map((s) => markedPersonText(s, emojis, { icons: v.groupIcons, lang }, confirmations)).join("\n"), LIMITS.fieldValue),
            inline: true,
        }));
        // Discord spreads a short last row over the whole width (two fields at half
        // width each), so Group 5 would sit in the middle instead of under Group 2.
        // Empty inline fields fill the last row up to three: every group keeps its column.
        while (fields.length % GRID_COLUMNS) fields.push({ name: "\u200b", value: "\u200b", inline: true });
        if (bench.length) {
            fields.push({
                name: `${[emojiText(emojis, statusEmojiName("bench")), benchWord(lang)].filter(Boolean).join(" ")} (${bench.length})`,
                value: joinClipped(bench.map((b) => personText(b, emojis, { icons: v.benchIcons, bold: false, lang })), " · ", lang),
                inline: false,
            });
        }
        if (link) fields.push({ name: "\u200b", value: link, inline: false });
        embed = {
            title,
            color: embedColor(event),
            description: clip(description, LIMITS.description),
            fields: fields.slice(0, LIMITS.fields),
            footer: { text: tr(lang, "Approved setup · version {version}", { version: approved.version || 1 }) },
        };
        if (!embed.description) delete embed.description;
        if (embedLength(embed) <= LIMITS.total) break;
    }
    if (approved.approvedAt) embed.timestamp = new Date(Number(approved.approvedAt)).toISOString();
    // Confirm, Cancel, Call invites, Ping everyone — one row (Discord's limit
    // is 5 buttons), in that order; the rows come from setupCore.js, so this
    // module never requires a *Bot.js back. Access is per button:
    // Confirm/Cancel are every raider's own (accessOf "event-signup" in the
    // command file), Call invites and Ping everyone the orga's alone (accessOf
    // "event") — merging the row changes nothing about that.
    const buttons = {
        type: 1,
        components: [...confirmButtonRow(event.id, lang).components, ...inviteButtonRow(event.id, lang).components, ...pingButtonRow(event.id, lang).components],
    };
    return { content: "", embeds: [embed], components: [buttons] };
}

// ---- DMs --------------------------------------------------------------------

/** Every raider of the approved lineup with where they stand — the bench only when it is posted (#517). */
function placementsOf(approved, { bench = false } = {}) {
    if (!approved) return [];
    const out = [];
    for (const g of approved.groups || []) {
        for (const s of g.slots || []) out.push({ ...s, group: g.index, bench: false });
    }
    if (bench) for (const b of approved.bench || []) out.push({ ...b, group: 0, bench: true });
    return out;
}

/** What a raider is told — a new DM goes out only when this changes. */
function placementSignature(p) {
    return p.bench ? `bench/${p.spec}` : `g${p.group}/${p.spec}/${p.role}`;
}

/** Whether the category sends setup DMs — the default of every event in it. */
function categoryDms(event, config = getConfig()) {
    return !!(event && event.categoryId && ((config && config.categorySetupDms) || {})[event.categoryId] === true);
}

/**
 * Whether this event sends setup DMs: the editor's switch "DMs an Spieler"
 * (`setupPost.dmsChoice`, stored with the post like "Bench mitposten"), else the
 * category's setting.
 */
function dmsEnabled(event, config = getConfig()) {
    const choice = event && event.setupPost && event.setupPost.dmsChoice;
    return typeof choice === "boolean" ? choice : categoryDms(event, config);
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
 * The DM for one raider in their language — pure.
 */
function buildSetupDm(event, placement, { messageUrl = "", reasons = [], fairness = false, lang = "de" } = {}) {
    const start = Number(event.startTime) || 0;
    const name = [escapeMd(placement.character), specLabel(placement.spec, lang)].filter(Boolean).join(" · ");
    const who = name ? ` (${name})` : "";
    const facts = start ? [[tr(lang, "Start"), `<t:${start}:d> <t:${start}:t>`]] : [];
    const buttons = messageUrl ? [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(tr(lang, "Go to the setup")).setURL(messageUrl)] : [];
    const base = { kind: "raid", color: embedColor(event), kicker: tr(lang, "Setup for {title}", { title: escapeMd(event.title || "Raid") }), facts, buttons };
    if (placement.bench) {
        const text = [fairness
            ? tr(lang, "This time on the **bench**{who} – next time you have priority.", { who })
            : tr(lang, "This time on the **bench**{who}.", { who })];
        // The proposal's own German wording (reasons.js, no user input), in the raider's language.
        if (reasons.length) text.push(tr(lang, "Reason: {reason}", { reason: reasons.map((r) => serviceText(lang, r)).join(" · ") }));
        return card({ ...base, title: tr(lang, "On the bench"), text: text.join("\n") });
    }
    return card({
        ...base,
        title: tr(lang, "Group {group} as {role}", { group: placement.group, role: roleLabel(placement.role, lang) || "Raider" }),
        text: name,
    });
}

function messageUrlOf(event) {
    const post = event && event.setupPost;
    // Only while the message is there (#537): a DM must not lead into a deleted post.
    return post && post.messageId && event.guildId ? linkCheck.messageLink(event.guildId, post.channelId, post.messageId) : "";
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
    const approved = approvedSetupOf(event);
    if (!approved) return { skipped: "no_approved_setup" };
    if (event.status === "cancelled") return { skipped: "cancelled" };
    if (!dmsEnabled(event, config)) return { skipped: "off" };
    if (running.has(event.id)) return { skipped: "running" };

    const told = { ...((event.setupPost && event.setupPost.told) || {}) };
    const people = placementsOf(approved, { bench: benchPosted(event) });
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
        if (event.setupPost && event.setupPost.messageId) await linkCheck.checkMessage(event.guildId, event.setupPost.channelId, event.setupPost.messageId);
        const messageUrl = messageUrlOf(event);
        for (let i = 0; i < todo.length; i++) {
            const p = todo[i];
            if (i && delayMs > 0) await sleep(delayMs);
            const payload = buildSetupDm(event, p, { messageUrl, fairness, reasons: p.bench ? benchReasons(event, p.userId) : [], lang: langOf(p.userId, { config }) });
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

const isUnknownMessage = (e) => !!(e && (e.code === 10008 || /unknown message/i.test(e.message || "")));

async function payloadFor(event, approved) {
    await loadAppEmojis(discord.getClient());
    return buildSetupMessage(event, approved, {
        emojis: appEmojiMap(), confirmations: confirmationsFor(event, approved), bench: benchPosted(event), lang: serverLang(),
    });
}

/**
 * Post the approved setup into the event's channel, or edit the message that is
 * already there. A draft is refused (`no_approved_setup`), a cancelled event
 * only gets an existing message marked (`cancelled` without one).
 * `bench` (true/false, #517) is the orga's "Bench mitposten": remembered on the
 * event (`setupPost.bench`) and used from then on; left out, the last choice stands.
 * @returns {Promise<{ action?: "posted"|"edited", code?: string, error?: string }>}
 */
async function postOrEditSetupMessage(eventId, { userId = "", now = Date.now(), bench } = {}) {
    if (typeof bench === "boolean" && eventStore.getEvent(eventId)) eventStore.setEventSetupPost(eventId, { bench });
    const event = eventStore.getEvent(eventId);
    if (!event) return { code: "not_found", error: "Event nicht gefunden." };
    const approved = approvedSetupOf(event);
    if (!approved) return { code: "no_approved_setup", error: "Es gibt noch kein freigegebenes Setup." };
    const post = event.setupPost || {};
    const cancelled = event.status === "cancelled";
    if (cancelled && !post.messageId) return { code: "cancelled", error: "Das Event ist abgesagt." };
    if (!event.channelId && !post.channelId) return { code: "no_channel", error: "Das Event hat keinen Kanal." };

    try {
        const payload = await payloadFor(event, approved);
        if (post.messageId) {
            try {
                const channel = await discord.fetchTextChannel(post.channelId);
                const message = await channel.messages.fetch(post.messageId);
                await message.edit(payload);
                eventStore.setEventSetupPost(event.id, { version: approved.version, editedAt: now, editedBy: str(userId), error: "", errorAt: 0 });
                return { action: "edited" };
            } catch (e) {
                // A message deleted by hand is posted anew — unless the event is cancelled.
                if (!isUnknownMessage(e) || cancelled) throw e;
            }
        }
        const channel = await discord.fetchTextChannel(event.channelId);
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
 * DMs (and the ping) can link to it/follow it, then the DMs in the background.
 * Returns once the message is done; `dms` is the running promise (null when
 * there is nothing to send).
 */
async function publishSetup(eventId, { userId = "", now = Date.now(), config = getConfig(), delayMs, bench, dms: dmsChoice } = {}) {
    // "DMs an Spieler": the orga's choice for this event, kept for the next post (undefined = keep)
    if (typeof dmsChoice === "boolean" && eventStore.getEvent(eventId)) eventStore.setEventSetupPost(eventId, { dmsChoice });
    const post = await postOrEditSetupMessage(eventId, { userId, now, bench });
    const event = eventStore.getEvent(eventId);
    // The very first post pings everyone placed — same as a manual "Ping
    // everyone" click, with whatever text the orga set (setupPing.js). Never
    // on a later edit: re-approving a small tweak must not ping the raid
    // again. Best-effort, like the DMs below — a failed ping never fails the
    // approval, it is simply not logged.
    if (event && post.action === "posted") {
        await callSetupPing({ guildId: event.guildId, eventId, userId }).catch(() => {});
    }
    let dms = null;
    if (event && !post.code && dmsEnabled(event, config)) {
        dms = sendSetupDms(eventId, { config, ...(delayMs !== undefined ? { delayMs } : {}) })
            .catch((e) => ({ skipped: "error", error: e && e.message }));
    }
    return { post, dms };
}

/** eventId → the last queued live refresh, so the edits of quick moves land in order. */
const liveQueue = new Map();

/**
 * After a live change of a posted setup (setupEditor.storeSetup): edit the
 * message to the new lineup. One after the other per event, each reading the
 * event fresh, so the last change is what stays in Discord. The last ping's
 * list follows too (setupPing.refreshSetupPing — an edit, it notifies nobody).
 * No new ping and no DMs — a quick reshuffle must not message anybody; "Setup
 * posten" sends the DMs still outstanding.
 * @returns {Promise<{ action?: string, code?: string, error?: string }>}
 */
function refreshLiveSetup(eventId, { userId = "", now } = {}) {
    return enqueue(eventId, async () => {
        const post = await postOrEditSetupMessage(eventId, { userId, now: now || Date.now() });
        // best-effort: a ping that cannot be edited never fails the change
        await refreshSetupPing(eventId).catch(() => {});
        return post;
    });
}

/** Run `task` after every edit already queued for the event — so an older payload never lands after a newer one. */
function enqueue(eventId, task) {
    const before = liveQueue.get(eventId) || Promise.resolve();
    const run = before.then(task);
    liveQueue.set(eventId, run);
    return run.finally(() => {
        if (liveQueue.get(eventId) === run) liveQueue.delete(eventId);
    });
}

/**
 * Edit the posted message in the event's queue — for a change of the marks
 * only (Confirm/Cancel), so the ping is left alone. Never posts a first one.
 * @returns {Promise<{ action?: string, code?: string, error?: string } | null>}
 */
function editSetupMessageQueued(eventId, { userId = "" } = {}) {
    return enqueue(eventId, async () => {
        const event = eventStore.getEvent(eventId);
        if (!event || !event.setupPost || !event.setupPost.messageId) return null;
        return postOrEditSetupMessage(eventId, { userId });
    });
}

/** eventId → the timer of a refresh waiting for more marks. */
const pendingEdits = new Map();
/** How long an edit waits for the next click of the orga — one edit for a run of quick marks. */
const MARK_EDIT_DELAY_MS = 1200;

/**
 * The orga marks several raiders in a row (setupConfirm.js): the message is
 * edited once, a moment after the last mark, instead of once per click — a
 * Discord edit takes a while and is rate limited per channel. A failure is
 * stored on the event (`setupPost.error`) like every edit and shows in the
 * editor's line under the bar.
 */
function scheduleSetupEdit(eventId, { userId = "", delayMs = MARK_EDIT_DELAY_MS } = {}) {
    const waiting = pendingEdits.get(eventId);
    if (waiting) clearTimeout(waiting);
    const timer = setTimeout(() => {
        pendingEdits.delete(eventId);
        editSetupMessageQueued(eventId, { userId }).catch(() => {});
    }, delayMs);
    if (typeof timer.unref === "function") timer.unref();
    pendingEdits.set(eventId, timer);
}

/** Bring an already posted setup message up to date (a cancellation, its reversal). Never posts a new one. */
async function refreshSetupMessage(eventId) {
    const event = eventStore.getEvent(eventId);
    if (!event || !event.setupPost || !event.setupPost.messageId) return null;
    const result = await postOrEditSetupMessage(eventId);
    return result.code ? result.error : null;
}

/**
 * Redraw every posted setup message of the last two days and the coming ones
 * (the server language changed — languageChange.js). Each edit runs in its
 * event's queue, so it never lands over a newer one; never posts a first one.
 * @returns {Promise<{ edited: number, failed: number }>}
 */
async function refreshSetupMessages({ now = Date.now() } = {}) {
    const since = Math.floor(now / 1000) - 2 * 86400;
    const out = { edited: 0, failed: 0 };
    for (const event of eventStore.listEvents("", { sinceSeconds: since })) {
        if (!event || !event.setupPost || !event.setupPost.messageId) continue;
        const result = await editSetupMessageQueued(event.id).catch((e) => ({ error: (e && e.message) || String(e) }));
        if (result && result.action) out.edited += 1;
        else if (result && result.error) out.failed += 1;
    }
    return out;
}

/**
 * What the editor says about posting — before the approval what *will* happen,
 * after it what did. Pure over event and config.
 */
function publishView(event, { config = getConfig(), channelName = "" } = {}) {
    const post = (event && event.setupPost) || {};
    const approved = approvedSetupOf(event);
    const setup = event && event.setup;
    // Before an approval the draft is what will be sent; afterwards the approved lineup.
    const lineup = setup && setup.status !== "approved" ? setup : approved;
    const bench = benchPosted(event);
    const people = placementsOf(lineup, { bench });
    const told = post.told || {};
    return {
        // "Bench mitposten" (#517): the last choice, off by default
        bench,
        benchCount: ((lineup && lineup.bench) || []).length,
        channelId: post.channelId || (event && event.channelId) || "",
        channelName: channelName || (event && event.channelName) || "",
        cancelled: !!(event && event.status === "cancelled"),
        dmsEnabled: dmsEnabled(event, config),
        // the category's default, so the editor can tell "chosen for this raid" from "as the category says"
        dmsDefault: categoryDms(event, config),
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
    liveQueue.clear();
    for (const timer of pendingEdits.values()) clearTimeout(timer);
    pendingEdits.clear();
}

module.exports = {
    LIMITS, DM_DELAY_MS,
    buildSetupMessage, buildSetupDm, embedLength, placementsOf, placementSignature, dmsEnabled, benchReasons,
    postOrEditSetupMessage, sendSetupDms, publishSetup, refreshSetupMessage, refreshLiveSetup,
    editSetupMessageQueued, scheduleSetupEdit, MARK_EDIT_DELAY_MS, publishView, refreshSetupMessages, _resetForTests,
};
