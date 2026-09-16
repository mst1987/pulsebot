// The raid overview on the talk server (#257): one bot message in the channel
// `discordServers.talkOverviewChannelId` that lists the upcoming raids of the
// event server, grouped by category, each with a link into its event channel
// over there — plus a select "Raid wählen, um dich anzumelden" and three link
// buttons into the web.
//
// It keeps itself current: a roster change of an own event
// (signupStore.onSignupsChanged), a newly created event (eventCreate.js) and a
// sweep every 5 minutes (Raid-Helper signups, raids that started) all end in
// syncOverview(), which edits the message only when its content changed and
// posts it anew when somebody deleted it. Where it sits lives in
// talkOverviewStore.js.
//
// Discord shapes the message: at most 25 embed fields (one per category), 1024
// characters per field, 6000 per embed, 25 select options (the next 25 raids).
// A channel link crosses servers as a plain URL — `<#id>` only resolves on the
// server it is posted on.
const crypto = require("crypto");
const { DateTime } = require("luxon");
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
} = require("discord.js");
const { embedAccentColor, publicBaseUrl } = require("../config/variables");
const discord = require("./discord");
const guildRoles = require("./guildRoles");
const { loadEventGroups } = require("./raidEventGroups");
const { getConfig } = require("./settingsStore");
const { onSignupsChanged } = require("./signupStore");
const { getOverviewState, setOverviewState } = require("./talkOverviewStore");
const { signupStatus } = require("../utils/attendance");

const SELECT_ID = "talk-signup";
// "Für alle Raids anmelden" / "Mehrere Raids wählen …" (#293, commands/signup/talkSignupAll|Multi.js)
const ALL_BUTTON_ID = "talk-signup-all";
const MULTI_BUTTON_ID = "talk-signup-multi";
const MAX_FIELDS = 25;
const MAX_FIELD_VALUE = 1024;
const MAX_EMBED_CHARS = 6000;
const MAX_OPTIONS = 25;
const ZONE = "Europe/Berlin";
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
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

/** "Mi 17.09. 19:30" in Berlin time; start is unix seconds (or ms). */
function formatStart(startTime) {
    const n = Number(startTime) || 0;
    if (!n) return "";
    const dt = DateTime.fromMillis(n < 1e12 ? n * 1000 : n, { zone: ZONE });
    return `${WEEKDAYS[dt.weekday - 1]} ${dt.toFormat("dd.MM. HH:mm")}`;
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

/** One raid as one line: title · date · fill · channel link (· Raid-Helper). */
function raidLine(event, eventGuildId) {
    // A cancelled event (#288) stays listed until its day, struck through, so nobody wonders where it went.
    if (event.status === "cancelled") {
        return [`~~${plain(event.title) || "Raid"}~~`, "**ABGESAGT**", formatStart(event.startTime)].filter(Boolean).join(" · ");
    }
    const parts = [`**${plain(event.title) || "Raid"}**`];
    const when = formatStart(event.startTime);
    if (when) parts.push(when);
    parts.push(`👥 ${fillText(event)}`);
    const url = channelUrl(eventGuildId, event.channelId);
    if (url) parts.push(`[#${plain(event.channelName) || "event"}](${url})`);
    if (event.source !== "eventhelper") parts.push("Raid-Helper");
    return parts.join(" · ");
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
            categoryName: g.categoryName || "Ohne Kategorie",
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
 * @param {{ eventGuildId?: string, eventGuildName?: string, baseUrl?: string, now?: number, categoryIds?: string[] }} opts
 * @returns {{ content: string, embeds: object[], components: object[] }} plain API JSON
 */
function buildOverviewMessage(groups, opts = {}) {
    const { eventGuildId = "", eventGuildName = "", baseUrl = publicBaseUrl } = opts;
    const list = upcomingGroups(groups, opts);
    const all = list.flatMap((g) => g.events.map((e) => ({ ...e, categoryName: g.categoryName })));
    // Nobody signs up for a cancelled raid (#288): it is shown, not offered.
    const signable = all.filter((e) => e.status !== "cancelled");

    const title = "Kommende Raids";
    const description = all.length
        ? `Aktualisiert sich selbst · Links führen in den Event-Kanal${eventGuildName ? ` auf **${plain(eventGuildName)}**` : ""}`
        : "Gerade sind keine Raids geplant. Neue Raids erscheinen hier von selbst.";
    let used = title.length + description.length;
    const fields = [];
    let shown = 0;

    for (const group of list) {
        if (fields.length >= MAX_FIELDS) break;
        const name = plain(group.categoryName).slice(0, 256) || "Ohne Kategorie";
        const lines = [];
        let length = 0;
        for (let i = 0; i < group.events.length; i++) {
            const line = raidLine(group.events[i], eventGuildId);
            const rest = group.events.length - i - 1;
            // Room for this line, plus a "+N weitere" line if more follow.
            const reserve = rest ? 24 : 0;
            const next = length + (lines.length ? 1 : 0) + line.length;
            if (next + reserve > MAX_FIELD_VALUE || used + name.length + next + reserve > MAX_EMBED_CHARS - 80) break;
            lines.push(line);
            length = next;
        }
        if (!lines.length) break;
        const hidden = group.events.length - lines.length;
        if (hidden) lines.push(`+${hidden} weitere`);
        const value = lines.join("\n");
        fields.push({ name, value, inline: false });
        used += name.length + value.length;
        shown += group.events.length - hidden;
    }

    const embed = new EmbedBuilder()
        .setColor(embedAccentColor)
        .setTitle(title)
        .setDescription(description);
    if (fields.length) embed.addFields(fields);
    const missing = all.length - shown;
    if (missing > 0) embed.setFooter({ text: `+${missing} weitere Raids in der Web-Übersicht` });

    const components = [];
    // Several raids at once (#293) — only EventHelper events take a signup here.
    if (signable.some((e) => e.source === "eventhelper")) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(ALL_BUTTON_ID).setStyle(ButtonStyle.Primary).setLabel("Für alle Raids anmelden").setEmoji("✅"),
            new ButtonBuilder().setCustomId(MULTI_BUTTON_ID).setStyle(ButtonStyle.Secondary).setLabel("Mehrere Raids wählen …"),
        ));
    }
    if (signable.length) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(SELECT_ID)
            .setPlaceholder("Einzelnen Raid wählen …")
            .addOptions(signable.slice(0, MAX_OPTIONS).map((e) => ({
                label: (plain(e.title) || "Raid").slice(0, 100),
                description: [formatStart(e.startTime), plain(e.categoryName)].filter(Boolean).join(" · ").slice(0, 100),
                value: String(e.id).slice(0, 100),
            })));
        components.push(new ActionRowBuilder().addComponents(select));
    }
    const links = overviewLinks(baseUrl);
    components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Web-Übersicht").setURL(links.web),
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Meine Anmeldungen").setURL(links.signups),
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Mein Profil").setURL(links.profile),
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

async function textChannel(client, channelId) {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("Übersichts-Kanal nicht gefunden oder kein Textkanal.");
    return channel;
}

/** Where the overview goes, or null when the talk server or its channel is not set. */
function overviewTarget(config = getConfig()) {
    const talkGuildId = guildRoles.talkGuildId(config);
    const channelId = String(((config && config.discordServers) || {}).talkOverviewChannelId || "").trim();
    return talkGuildId && channelId ? { talkGuildId, channelId } : null;
}

/** The payload as it would be posted now — for the sync and the dry run. */
async function currentPayload({ config = getConfig(), now = Date.now() } = {}) {
    const eventGuildId = guildRoles.eventGuildId(config);
    const { groups, error } = await loadEventGroups(eventGuildId);
    const guild = discord.getGuild(eventGuildId);
    const payload = buildOverviewMessage(groups, {
        eventGuildId,
        eventGuildName: guild ? guild.name : "",
        now,
        categoryIds: config.categoryIds || [],
    });
    return { payload, error };
}

async function runSync({ repost = false, now = Date.now(), config = getConfig() } = {}) {
    const target = overviewTarget(config);
    if (!target) return { status: "unconfigured" };
    const state = getOverviewState();
    const fail = (message) => {
        setOverviewState({ checkedAt: now, error: message });
        return { status: "error", error: message };
    };
    try {
        const client = discord.getClient();
        if (!client) return fail("Bot nicht verbunden.");
        const { payload, error } = await currentPayload({ config, now });
        // A Raid-Helper outage would post a list without its events: leave an
        // existing message as it is and try again on the next sweep.
        if (error && state.messageId && !repost) return fail(`Events nicht vollständig ladbar: ${error}`);
        const hash = payloadHash(payload);
        const channel = await textChannel(client, target.channelId);

        const sameChannel = state.messageId && state.channelId === target.channelId;
        if (sameChannel && !repost) {
            try {
                const message = await channel.messages.fetch(state.messageId);
                if (state.hash === hash) {
                    setOverviewState({ checkedAt: now, error: "" });
                    return { status: "unchanged", messageId: state.messageId };
                }
                await message.edit(payload);
                setOverviewState({ hash, editedAt: now, checkedAt: now, error: "" });
                return { status: "edited", messageId: state.messageId };
            } catch (e) {
                if (!isUnknownMessage(e)) throw e;
                // Deleted by hand: posted anew below.
            }
        } else if (state.messageId) {
            // Asked to re-post, or the channel changed: the old message goes.
            try {
                const old = await textChannel(client, state.channelId || target.channelId);
                const message = await old.messages.fetch(state.messageId);
                await message.delete();
            } catch (e) {
                if (!isUnknownMessage(e)) console.warn("[talkOverview] alte Nachricht nicht gelöscht:", e.message);
            }
        }

        const posted = await channel.send(payload);
        setOverviewState({
            channelId: target.channelId, messageId: posted.id, hash,
            postedAt: now, editedAt: 0, checkedAt: now, error: "",
        });
        return { status: "posted", messageId: posted.id };
    } catch (e) {
        return fail((e && e.message) || "Übersicht konnte nicht aktualisiert werden.");
    }
}

let queue = Promise.resolve();

/**
 * Bring the overview up to date. Runs one at a time, so a sweep and a roster
 * change never post two messages.
 * @param {{ repost?: boolean }} opts repost = delete the old message and post a new one
 * @returns {Promise<{ status: "unconfigured"|"unchanged"|"edited"|"posted"|"error", messageId?: string, error?: string }>}
 */
function syncOverview(opts = {}) {
    const run = queue.then(() => runSync(opts));
    queue = run.catch(() => {});
    return run;
}

/** The overview's state for the settings page. */
function overviewStatus(config = getConfig()) {
    const target = overviewTarget(config);
    const state = getOverviewState();
    const active = !!target && state.channelId === target.channelId && !!state.messageId;
    return {
        configured: !!target,
        channelId: target ? target.channelId : "",
        messageId: active ? state.messageId : "",
        messageUrl: active ? `https://discord.com/channels/${target.talkGuildId}/${state.channelId}/${state.messageId}` : "",
        postedAt: active ? state.postedAt : 0,
        editedAt: active ? state.editedAt : 0,
        checkedAt: state.checkedAt || 0,
        error: state.error || "",
    };
}

let debounceTimer = null;

/** Sync after a short pause; a burst of triggers collapses into one run. */
function scheduleOverviewSync({ delayMs = DEBOUNCE_MS } = {}) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        syncOverview().catch((e) => console.error("[talkOverview]", e.message));
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

module.exports = {
    SELECT_ID, ALL_BUTTON_ID, MULTI_BUTTON_ID, MAX_OPTIONS, RAIDHELPER_CREATE_DELAY_MS,
    overviewLinks, channelUrl, formatStart, raidLine, upcomingGroups, buildOverviewMessage, payloadHash,
    overviewTarget, currentPayload, syncOverview, overviewStatus, scheduleOverviewSync, startTalkOverview,
};
