// The raid overview (#257, #361): one bot message per configured event server
// that has an overview target set (`discordServers.eventGuilds[].
// overviewGuildId`/`overviewChannelId` — the talk server, another event
// server, or its own), listing that server's upcoming raids, grouped by
// category, each with a link into its event channel over there — plus a
// select "Raid wählen, um dich anzumelden" and three link buttons into the
// web.
//
// It keeps itself current: a roster change of an own event
// (signupStore.onSignupsChanged), a newly created event (eventCreate.js) and a
// sweep every 5 minutes (Raid-Helper signups, raids that started) all end in
// syncOverview(), which resyncs every configured entry — each edits its own
// message only when its content changed and posts it anew when somebody
// deleted it. Where each one sits lives in talkOverviewStore.js, keyed by
// event-server guild id.
//
// Discord shapes the message: at most 25 embed fields (one per category), 1024
// characters per field, 6000 per embed, 25 select options (the next 25 raids).
// A channel link crosses servers as a plain URL — `<#id>` only resolves on the
// server it is posted on.
const crypto = require("crypto");
const { discordTimestamp, shortServerTime } = require("../../utils/time");
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
} = require("discord.js");
const { embedAccentColor, publicBaseUrl } = require("../../config/variables");
const discord = require("../discord/discord");
const guildRoles = require("../discord/guildRoles");
const { loadEventGroups } = require("../events/raidEventGroups");
const { getConfig } = require("../../stores/settingsStore");
const { onSignupsChanged } = require("../../stores/signupStore");
const { getOverviewState, setOverviewState } = require("../../stores/talkOverviewStore");
const { signupStatus } = require("../../utils/attendance");
const { appEmojiMap, emojiText, uiEmojiName } = require("../discord/appEmojis");

// Between two raid stanzas (each three lines) — a blank line for breathing room.
const RAID_SEP = "\n\n";
// An empty field between two categories: Discord gives every field the same
// tight spacing, so a real gap needs a field of its own — zero-width space in
// both name and value keeps it invisible.
const SPACER = "​";
const spacerField = () => ({ name: SPACER, value: SPACER, inline: false });

const SELECT_ID = "talk-signup";
// "Für alle Raids anmelden" / "Mehrere Raids wählen …" (#293, commands/signup/talkSignupAll|Multi.js)
const ALL_BUTTON_ID = "talk-signup-all";
const MULTI_BUTTON_ID = "talk-signup-multi";
const MAX_FIELDS = 25;
const MAX_FIELD_VALUE = 1024;
const MAX_EMBED_CHARS = 6000;
const MAX_OPTIONS = 25;
const SWEEP_MS = 5 * 60 * 1000;
const DEBOUNCE_MS = 3000;
// Raid-Helper's event list is cached for 30 s (raidEventGroups.js): a sync
// right after creating a Raid-Helper event would not see it yet.
const RAIDHELPER_CREATE_DELAY_MS = 35 * 1000;

/** The web pages the buttons lead to. */
function overviewLinks(baseUrl = publicBaseUrl) {
    const base = String(baseUrl || "").replace(/\/+$/, "");
    return {
        web: `${base}/raids`,
        signups: `${base}/signups`,
        profile: `${base}/profile`,
    };
}

/** "https://discord.com/channels/<guild>/<channel>", "" without both ids. */
function channelUrl(guildId, channelId) {
    return guildId && channelId ? `https://discord.com/channels/${guildId}/${channelId}` : "";
}

/** The public event page ("/e/<id>") on `baseUrl` — only own events have one, "" without a base url. */
function eventUrl(eventId, baseUrl) {
    const base = String(baseUrl || "").replace(/\/+$/, "");
    return base && eventId ? `${base}/e/${encodeURIComponent(eventId)}` : "";
}

/**
 * "Wed 17 Sep 19:30" in server time (Berlin); start is unix seconds (or ms).
 * For the select options, which cannot render a Discord timestamp — the embed
 * lines use `<t:…:F>` instead, so every reader sees their own time zone.
 */
function formatStart(startTime) {
    return shortServerTime(startTime);
}

/** Markdown that would break a line's layout (bold, links) taken out of a title. */
function plain(text) {
    return String(text || "").replace(/[*_`~|[\]\\]/g, "").replace(/\s+/g, " ").trim();
}

/** How many are coming: signed and late, the same count as the event message. */
function attendingCount(event) {
    return (event.signUps || []).filter((s) => ["signed", "late"].includes(signupStatus(s))).length;
}

/** "22/25" against the planned size, "12" without one. */
function fillText(event) {
    const n = attendingCount(event);
    return Number(event.size) > 0 ? `${n}/${event.size}` : String(n);
}

/**
 * One raid as three lines — title (linked to its public web page for an own
 * event), date, and a small ("-#", subtext) meta line with the fill and the
 * channel link. Discord's header markdown (`#`/`##`/`###`) does not render
 * bigger inside an embed, so the title only gets emphasis through bold + the
 * link; the meta line is the one that shrinks.
 */
function raidLine(event, eventGuildId, { emojis = {}, baseUrl = "" } = {}) {
    const title = plain(event.title) || "Raid";
    // A cancelled event (#288) stays listed until its day, struck through, so nobody wonders where it went.
    if (event.status === "cancelled") {
        return [`~~${title}~~`, "**CANCELLED**", discordTimestamp(event.startTime, "F")].filter(Boolean).join(" · ");
    }
    const link = event.source === "eventhelper" ? eventUrl(event.id, baseUrl) : "";
    const titleLine = `**${link ? `[${title}](${link})` : title}**`;
    const when = discordTimestamp(event.startTime, "F");
    const dateLine = when ? `${emojiText(emojis, uiEmojiName("date"), "🗓️")} ${when}` : "";
    const metaParts = [`${emojiText(emojis, uiEmojiName("signups"), "👥")} ${fillText(event)}`];
    const url = channelUrl(eventGuildId, event.channelId);
    if (url) metaParts.push(`[#${plain(event.channelName) || "event"}](${url})`);
    if (event.source !== "eventhelper") metaParts.push("Raid-Helper");
    return [titleLine, dateLine, `-# ${metaParts.join(" · ")}`].filter(Boolean).join("\n");
}

/**
 * The upcoming raids, soonest first, grouped by category — categories ordered by
 * their soonest raid. Only configured event categories when there are any.
 */
function upcomingGroups(groups, { now = Date.now(), categoryIds = [] } = {}) {
    const allowed = new Set((categoryIds || []).map(String));
    const nowSec = Math.floor(now / 1000);
    return (groups || [])
        .filter((g) => !allowed.size || allowed.has(String(g.categoryId || "")))
        .map((g) => ({
            categoryId: g.categoryId || "",
            categoryName: g.categoryName || "No category",
            events: (g.events || [])
                .filter((e) => e && e.id && (Number(e.startTime) || 0) >= nowSec)
                .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0)),
        }))
        .filter((g) => g.events.length)
        .sort((a, b) => (Number(a.events[0].startTime) || 0) - (Number(b.events[0].startTime) || 0)
            || a.categoryName.localeCompare(b.categoryName));
}

/**
 * The message payload (pure — no Discord call).
 * @param {object[]} groups loadEventGroups()'s groups
 * @param {{ eventGuildId?: string, eventGuildName?: string, baseUrl?: string, now?: number, categoryIds?: string[], emojis?: object }} opts
 * @returns {{ content: string, embeds: object[], components: object[] }} plain API JSON
 */
function buildOverviewMessage(groups, opts = {}) {
    const { eventGuildId = "", eventGuildName = "", baseUrl = publicBaseUrl, emojis = {} } = opts;
    const list = upcomingGroups(groups, opts);
    const all = list.flatMap((g) => g.events.map((e) => ({ ...e, categoryName: g.categoryName })));
    // Nobody signs up for a cancelled raid (#288): it is shown, not offered.
    const signable = all.filter((e) => e.status !== "cancelled");

    const title = "Upcoming raids";
    const description = all.length
        ? `Updates itself · links lead to the event channel${eventGuildName ? ` on **${plain(eventGuildName)}**` : ""}`
        : "No raids are planned right now. New raids show up here by themselves.";
    let used = title.length + description.length;
    const fields = [];
    let shown = 0;

    for (const group of list) {
        // A spacer precedes every category but the first, so it needs its own
        // slot in the 25-field budget too.
        const withSpacer = fields.length > 0;
        if (fields.length + (withSpacer ? 2 : 1) > MAX_FIELDS) break;
        const name = plain(group.categoryName).slice(0, 256) || "No category";
        const lines = [];
        let length = 0;
        for (let i = 0; i < group.events.length; i++) {
            const line = raidLine(group.events[i], eventGuildId, { emojis, baseUrl });
            const rest = group.events.length - i - 1;
            // Room for this line, plus a "+N more" line if more follow.
            const reserve = rest ? 24 : 0;
            const next = length + (lines.length ? RAID_SEP.length : 0) + line.length;
            if (next + reserve > MAX_FIELD_VALUE || used + name.length + next + reserve > MAX_EMBED_CHARS - 80) break;
            lines.push(line);
            length = next;
        }
        if (!lines.length) break;
        const hidden = group.events.length - lines.length;
        if (hidden) lines.push(`+${hidden} more`);
        const value = lines.join(RAID_SEP);
        if (withSpacer) fields.push(spacerField());
        fields.push({ name, value, inline: false });
        used += name.length + value.length + (withSpacer ? SPACER.length * 2 : 0);
        shown += group.events.length - hidden;
    }

    const embed = new EmbedBuilder()
        .setColor(embedAccentColor)
        .setTitle(title)
        .setDescription(description);
    if (fields.length) embed.addFields(fields);
    const missing = all.length - shown;
    if (missing > 0) embed.setFooter({ text: `+${missing} more raids in the web overview` });

    const components = [];
    // Several raids at once (#293) — only EventHelper events take a signup here.
    if (signable.some((e) => e.source === "eventhelper")) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(ALL_BUTTON_ID).setStyle(ButtonStyle.Primary).setLabel("Sign up for all raids").setEmoji("✅"),
            new ButtonBuilder().setCustomId(MULTI_BUTTON_ID).setStyle(ButtonStyle.Secondary).setLabel("Pick several raids …"),
        ));
    }
    if (signable.length) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(SELECT_ID)
            .setPlaceholder("Pick a single raid …")
            .addOptions(signable.slice(0, MAX_OPTIONS).map((e) => ({
                label: (plain(e.title) || "Raid").slice(0, 100),
                description: [formatStart(e.startTime), plain(e.categoryName)].filter(Boolean).join(" · ").slice(0, 100),
                value: String(e.id).slice(0, 100),
            })));
        components.push(new ActionRowBuilder().addComponents(select));
    }
    const links = overviewLinks(baseUrl);
    components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Web overview").setURL(links.web),
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("My signups").setURL(links.signups),
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("My profile").setURL(links.profile),
    ));

    return {
        content: "",
        embeds: [embed.toJSON()],
        components: components.map((row) => row.toJSON()),
    };
}

/** A stable fingerprint of a payload: same content, same hash. */
function payloadHash(payload) {
    return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

function isUnknownMessage(e) {
    return !!(e && (e.code === 10008 || /unknown message/i.test(e.message || "")));
}

const OVERVIEW_CHANNEL_MISSING = "Übersichts-Kanal nicht gefunden oder kein Textkanal.";

/** Every configured event server that has an overview target set (both guild and channel). */
function overviewEntries(config = getConfig()) {
    const servers = (config && config.discordServers) || {};
    const entries = Array.isArray(servers.eventGuilds) ? servers.eventGuilds : [];
    return entries.filter((e) => e && e.guildId && e.overviewGuildId && e.overviewChannelId);
}

/**
 * The payload as it would be posted now, for one event server — for the sync
 * and the dry run. `guildId` defaults to the first configured event server,
 * for callers that only ever cared about "the" event server.
 */
async function currentPayload({ config = getConfig(), now = Date.now(), guildId = guildRoles.eventGuildId(config) } = {}) {
    const { groups, error } = await loadEventGroups(guildId);
    const guild = discord.getGuild(guildId);
    const payload = buildOverviewMessage(groups, {
        eventGuildId: guildId,
        eventGuildName: guild ? guild.name : "",
        now,
        categoryIds: config.categoryIds || [],
        emojis: appEmojiMap(),
    });
    return { payload, error };
}

/** One event server's own sync: builds, then edits/reposts/posts its own message, tracked under its own guild id. */
async function runSyncOne(entry, { repost = false, now = Date.now(), config = getConfig() } = {}) {
    const label = entry.label || "";
    const state = getOverviewState(entry.guildId);
    const fail = (message) => {
        setOverviewState(entry.guildId, { checkedAt: now, error: message });
        return { guildId: entry.guildId, label, status: "error", error: message };
    };
    try {
        if (!discord.isOnline()) return fail("Bot nicht verbunden.");
        const { payload, error } = await currentPayload({ config, now, guildId: entry.guildId });
        // A Raid-Helper outage would post a list without its events: leave an
        // existing message as it is and try again on the next sweep.
        if (error && state.messageId && !repost) return fail(`Events nicht vollständig ladbar: ${error}`);
        const hash = payloadHash(payload);
        const channel = await discord.fetchTextChannel(entry.overviewChannelId, OVERVIEW_CHANNEL_MISSING);

        const sameChannel = state.messageId && state.channelId === entry.overviewChannelId;
        if (sameChannel && !repost) {
            try {
                const message = await channel.messages.fetch(state.messageId);
                if (state.hash === hash) {
                    setOverviewState(entry.guildId, { checkedAt: now, error: "" });
                    return { guildId: entry.guildId, label, status: "unchanged", messageId: state.messageId };
                }
                await message.edit(payload);
                setOverviewState(entry.guildId, { hash, editedAt: now, checkedAt: now, error: "" });
                return { guildId: entry.guildId, label, status: "edited", messageId: state.messageId };
            } catch (e) {
                if (!isUnknownMessage(e)) throw e;
                // Deleted by hand: posted anew below.
            }
        } else if (state.messageId) {
            // Asked to re-post, or the channel changed: the old message goes.
            try {
                const old = await discord.fetchTextChannel(state.channelId || entry.overviewChannelId, OVERVIEW_CHANNEL_MISSING);
                const message = await old.messages.fetch(state.messageId);
                await message.delete();
            } catch (e) {
                if (!isUnknownMessage(e)) console.warn("[talkOverview] alte Nachricht nicht gelöscht:", e.message);
            }
        }

        const posted = await channel.send(payload);
        setOverviewState(entry.guildId, {
            channelId: entry.overviewChannelId, messageId: posted.id, hash,
            postedAt: now, editedAt: 0, checkedAt: now, error: "",
        });
        return { guildId: entry.guildId, label, status: "posted", messageId: posted.id };
    } catch (e) {
        return fail((e && e.message) || "Übersicht konnte nicht aktualisiert werden.");
    }
}

/**
 * With `guildId`: syncs only that one event server's overview, returning its
 * single result (the same shape runSync used to return before several event
 * servers existed) — "unconfigured" when that guild has no target set.
 * Without `guildId`: syncs every configured entry in turn (one entry's
 * failure never blocks another's), returning `{ results: [...] }`.
 */
async function runSync({
    repost = false, now = Date.now(), config = getConfig(), guildId = "",
} = {}) {
    const entries = overviewEntries(config);
    if (guildId) {
        const entry = entries.find((e) => e.guildId === String(guildId));
        if (!entry) return { status: "unconfigured" };
        return runSyncOne(entry, { repost, now, config });
    }
    const results = [];
    for (const entry of entries) results.push(await runSyncOne(entry, { repost, now, config }));
    return { results };
}

let queue = Promise.resolve();

/**
 * Bring the overview (or, with `guildId`, one event server's own overview) up
 * to date. Runs one at a time, so a sweep and a roster change never post two
 * messages on top of each other.
 * @param {{ repost?: boolean, guildId?: string }} opts repost = delete the old message and post a new one
 * @returns {Promise<{ status: "unconfigured"|"unchanged"|"edited"|"posted"|"error", messageId?: string, error?: string }
 *   | { results: object[] }>} a single result with `guildId`, or `{ results }` over every configured entry without one
 */
function syncOverview(opts = {}) {
    const run = queue.then(() => runSync(opts));
    queue = run.catch(() => {});
    return run;
}

/** Every configured event server's overview state, for the settings page. */
function overviewStatus(config = getConfig()) {
    return overviewEntries(config).map((entry) => {
        const state = getOverviewState(entry.guildId);
        const active = state.channelId === entry.overviewChannelId && !!state.messageId;
        return {
            guildId: entry.guildId,
            label: entry.label || "",
            configured: true,
            channelId: entry.overviewChannelId,
            messageId: active ? state.messageId : "",
            messageUrl: active ? `https://discord.com/channels/${entry.overviewGuildId}/${state.channelId}/${state.messageId}` : "",
            postedAt: active ? state.postedAt : 0,
            editedAt: active ? state.editedAt : 0,
            checkedAt: state.checkedAt || 0,
            error: state.error || "",
        };
    });
}

let debounceTimer = null;

/** Sync after a short pause; a burst of triggers collapses into one run. */
function scheduleOverviewSync({ delayMs = DEBOUNCE_MS, ...opts } = {}) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        syncOverview(opts).catch((e) => console.error("[talkOverview]", e.message));
    }, delayMs);
    if (debounceTimer.unref) debounceTimer.unref();
    return debounceTimer;
}

let stopFn = null;

/**
 * Keep the overview current: roster changes (debounced), and a sweep every
 * `intervalMs`. The first run waits `firstDelayMs`, so the bot is logged in.
 * Idempotent; returns the stop function.
 */
function startTalkOverview({ intervalMs = SWEEP_MS, debounceMs = DEBOUNCE_MS, firstDelayMs = 30 * 1000 } = {}) {
    if (stopFn) return stopFn;
    const run = () => syncOverview().catch((e) => console.error("[talkOverview]", e.message));
    const off = onSignupsChanged(() => scheduleOverviewSync({ delayMs: debounceMs }));
    const first = setTimeout(run, firstDelayMs);
    if (first.unref) first.unref();
    const interval = setInterval(run, intervalMs);
    if (interval.unref) interval.unref();
    stopFn = () => {
        off();
        clearTimeout(first);
        clearInterval(interval);
        clearTimeout(debounceTimer);
        debounceTimer = null;
        stopFn = null;
    };
    return stopFn;
}

/** Stop what startTalkOverview() set up (idempotent). */
function stopTalkOverview() {
    if (stopFn) stopFn();
}

module.exports = {
    SELECT_ID, ALL_BUTTON_ID, MULTI_BUTTON_ID, RAIDHELPER_CREATE_DELAY_MS, channelUrl, currentPayload, syncOverview, overviewStatus,
    scheduleOverviewSync, startTalkOverview, stopTalkOverview,
    // only for the tests (#424): not part of the module's API
    _internal: {
        overviewLinks, formatStart, buildOverviewMessage, payloadHash,
    },
};
