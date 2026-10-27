// The raid list per link (#257, #361, #890, #892): one bot message per link
// (`discordServers.links[]` `{ from, to, channelId, lang, versions }`) in its
// channel on `to`, listing the upcoming raids of `from` as an agenda by day
// (design D3, #892): one field per day, one stanza per raid with time, title
// (linked to its public web page), instance and size, lead, role counts,
// signups, the event channel (with the server's name when the list sits on
// another server) and the category — plus the sign-up buttons, a select and
// three link buttons into the web.
//
// It keeps itself current: a roster change of an own event
// (signupStore.onSignupsChanged), a newly created event (eventCreate.js) and a
// sweep every 5 minutes (Raid-Helper signups, raids that started) all end in
// syncOverview(), which resyncs every link — each edits its own message only
// when its content changed and posts it anew when somebody deleted it. Where
// each one sits lives in talkOverviewStore.js, keyed `from:to` since #892 (two
// links of one source = two messages); the first link of a source takes over
// the record that was keyed by the source alone before. The full sync also
// deletes the message of a link that is gone (removed, or its source or
// target changed) and drops its record (pruneOrphans).
//
// Discord shapes the message: at most 25 embed fields, 1024 characters per
// field, 6000 per embed, 25 select options (the next 25 raids). When the raids
// do not fit, the latest ones are left out and the footer says how many. A
// channel link crosses servers as a plain URL — `<#id>` only resolves on the
// server it is posted on.
//
// Languages (#892): the frame (title, description, day headings, buttons)
// speaks the link's language (`link.lang`, empty = the server language,
// services/discord/botLanguage.js `serverLang`); every raid stanza speaks its
// category's language (`eventLang`), so a PuG raid reads English beside German
// guild raids. The frame language is hashed with the payload, so a change of
// it redraws the message on the next sync (languageChange.js schedules one).
const crypto = require("crypto");
const { isRaidSibling } = require("../../utils/raidGroup");
const { serverDateTime, discordTimestamp } = require("../../utils/time");
const { tr, dateLocale } = require("../../utils/i18n/botText");
const { serverLang, eventLang } = require("../discord/botLanguage");
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
} = require("discord.js");
const { embedAccentColor } = require("../../config/variables");
const discord = require("../discord/discord");
const linkCheck = require("../discord/linkCheck");
const guildRoles = require("../discord/guildRoles");
const { loadEventGroups } = require("../events/raidEventGroups");
const { getConfig } = require("../../stores/settingsStore");
const { versionOfEvent, isVersionVisible } = require("../events/mainVersion");
const { versionShort } = require("../events/versionTag");
const { VERSIONS, instanceById } = require("../../config/gameVersions");
const { entryForSpec } = require("../../config/classlist");
const { onSignupsChanged } = require("../../stores/signupStore");
const {
    getOverviewState, setOverviewState, overviewKeys, listOverviewKeys, removeOverviewState,
} = require("../../stores/talkOverviewStore");
const { readStored } = require("../../stores/configStore");
const { signupStatus } = require("../../utils/attendance");
const { accountCount, ATTENDING_STATUSES } = require("../../utils/signup/capacity");

// Between two raid stanzas of one day — a blank line for breathing room.
const RAID_SEP = "\n\n";
// The name of a field that continues a day whose raids overflow 1024
// characters: a zero-width space, Discord refuses an empty name.
const SPACER = "​";
// What a raid line shows instead of a link to a channel that is gone (#537), in English (tr() translates it).
const CHANNEL_MISSING = "channel missing";
const NO_CATEGORY = "No category";
// Plural pairs of the meta line (singular, plural) — English, tr() translates both.
const COUNT_TEXT = {
    tank: ["1 tank", "{count} tanks"],
    healer: ["1 healer", "{count} healers"],
    dps: ["{count} DPS", "{count} DPS"],
    signup: ["1 signup", "{count} signups"],
};

const SELECT_ID = "talk-signup";
// "Für alle Raids anmelden" / "Mehrere Raids wählen …" (#293, commands/signup/talkSignupAll|Multi.js)
const ALL_BUTTON_ID = "talk-signup-all";
const MULTI_BUTTON_ID = "talk-signup-multi";
const MAX_FIELDS = 25;
const MAX_FIELD_VALUE = 1024;
const MAX_EMBED_CHARS = 6000;
// Kept free of the 6000 for the footer "+N more raids in the web overview".
const FOOTER_RESERVE = 80;
const MAX_OPTIONS = 25;
const SWEEP_MS = 5 * 60 * 1000;
const DEBOUNCE_MS = 3000;
// Raid-Helper's event list is cached for 30 s (raidEventGroups.js): a sync
// right after creating a Raid-Helper event would not see it yet.
const RAIDHELPER_CREATE_DELAY_MS = 35 * 1000;

/**
 * `baseUrl` when it is an address a raider can open (http/https), without
 * trailing slashes — "" otherwise (#537: no links into the localhost fallback).
 */
function usableBase(baseUrl) {
    const base = String(baseUrl || "").replace(/\/+$/, "");
    return /^https?:\/\/[^\s/]+/i.test(base) ? base : "";
}

/** The web pages the buttons lead to; null without a usable base url (no buttons then). */
function overviewLinks(baseUrl = linkCheck.webBase()) {
    const base = usableBase(baseUrl);
    if (!base) return null;
    return {
        web: `${base}/raids`,
        signups: `${base}/signups`,
        profile: `${base}/profile`,
    };
}

/** The public event page ("/e/<id>") on `baseUrl` — only own events have one, "" without a base url. */
function eventUrl(eventId, baseUrl) {
    const base = usableBase(baseUrl);
    return base && eventId ? `${base}/e/${encodeURIComponent(eventId)}` : "";
}

/** Markdown that would break a line's layout (bold, links) taken out of a title. */
function plain(text) {
    return String(text || "").replace(/[*_`~|[\]\\]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * The channel part of a raid's meta line (#537): a link only when the channel
 * exists (linkCheck), "channel missing" as plain text when it is gone, the bare
 * name while nothing is known (bot offline since the start). On another
 * server than the list (#892) a known channel names its server: "#do-ssc on
 * PuG-Server".
 */
function channelPart(event, eventGuildId, { channelInfo, lang, serverName, crossServer }) {
    if (!event.channelId) return "";
    const name = `#${plain(event.channelName) || "event"}`;
    const info = channelInfo(eventGuildId, event.channelId);
    if (info.state === "missing" && !info.url) return tr(lang, CHANNEL_MISSING);
    const channel = info.url ? `[${name}](${info.url})` : name;
    return crossServer && serverName ? tr(lang, "{channel} on {server}", { channel, server: plain(serverName) }) : channel;
}

/**
 * "Do. 17 Sep. 19:30" / "Thu 17 Sep 19:30" in server time (Berlin); start is
 * unix seconds (or ms). For the select options, which cannot render a Discord
 * timestamp — the embed lines use Discord timestamps instead, so every reader
 * sees their own time zone.
 */
function formatStart(startTime, lang = "de") {
    const dt = serverDateTime(startTime);
    return dt ? dt.setLocale(dateLocale(lang)).toFormat("ccc d LLL HH:mm") : "";
}

/** "Donnerstag, 17. September" / "Thursday 17 September" — a day heading in server time. */
function dayHeading(startTime, lang = "de") {
    const dt = serverDateTime(startTime);
    if (!dt) return "";
    return dt.setLocale(dateLocale(lang)).toFormat(lang === "en" ? "cccc d LLLL" : "cccc, d. LLLL");
}

/** The server-time day of a start ("2026-09-17"), the key raids are grouped by. */
function dayKey(startTime) {
    const dt = serverDateTime(startTime);
    return dt ? dt.toFormat("yyyy-LL-dd") : "";
}

/** How many single Discord accounts are coming (#520): signed and late, the same count as the event message. */
function attendingCount(event) {
    return accountCount(event.signUps || [], signupStatus);
}

const ROLE_ALIASES = {
    tank: "tank", tanks: "tank",
    healer: "healer", healers: "healer", heal: "healer", healing: "healer",
    melee: "dps", ranged: "dps", caster: "dps", dps: "dps", damage: "dps",
};

/**
 * "tank" | "healer" | "dps" of one signup — its stored role (own events), else
 * its spec's, else Raid-Helper's role name; "" when none says (a "Late" or
 * unknown spec without a role): such a signup counts as a signup, not as DPS.
 */
function roleOf(signUp) {
    for (const raw of [signUp.role, (entryForSpec(signUp.specName) || {}).role, signUp.roleName]) {
        const role = ROLE_ALIASES[String(raw || "").trim().toLowerCase()];
        if (role) return role;
    }
    return "";
}

/** The attending accounts per role — each account once, by its first attending signup. */
function roleCounts(event) {
    const counts = { tank: 0, healer: 0, dps: 0 };
    const seen = new Set();
    for (const s of event.signUps || []) {
        if (!s || !ATTENDING_STATUSES.includes(signupStatus(s))) continue;
        const uid = String(s.userId || "");
        if (uid) {
            if (seen.has(uid)) continue;
            seen.add(uid);
        }
        const role = roleOf(s);
        if (role) counts[role] += 1;
    }
    return counts;
}

function countText(kind, count, lang) {
    const [one, many] = COUNT_TEXT[kind];
    return tr(lang, count === 1 ? one : many, { count });
}

/** "SSC + TK 25" — the instances by their short name and the size; "" when the event names no instance. */
function instancePart(event) {
    const ids = Array.isArray(event.instanceIds) ? event.instanceIds : [];
    const found = ids.map((id) => instanceById(id)).filter(Boolean);
    if (!found.length) return "";
    const names = found.map((i) => plain(i.short || i.name)).filter(Boolean).join(" + ");
    const size = Number(event.size) || Number(found[0].defaultSize) || 0;
    return [names, size ? String(size) : ""].filter(Boolean).join(" ");
}

/**
 * One raid as two lines (#892, design D3): the time as a Discord timestamp,
 * the title (linked to its public page for an own event), instance and size;
 * below, small ("-#"), version, category, lead, role counts, signups, channel
 * and the source. A cancelled raid (#288) stays listed until its day, struck
 * through and marked "cancelled".
 */
function raidStanza(event, eventGuildId, opts) {
    const { baseUrl, channelInfo, lang, serverName, crossServer, leaderName, versionTitled } = opts;
    const title = plain(event.title) || "Raid";
    const time = discordTimestamp(event.startTime, "t");
    const category = plain(event.categoryName) || tr(lang, NO_CATEGORY);
    const channel = channelPart(event, eventGuildId, { channelInfo, lang, serverName, crossServer });
    const version = versionTitled ? versionShort(event.versionId) : "";
    if (event.status === "cancelled") {
        const head = [time, `~~${title}~~`, tr(lang, "cancelled")].filter(Boolean).join(" · ");
        return [head, `-# ${[version, category, channel].filter(Boolean).join(" · ")}`].join("\n");
    }
    const link = event.source === "eventhelper" ? eventUrl(event.id, baseUrl) : "";
    const head = [time, `**${link ? `[${title}](${link})` : title}**`, instancePart(event)].filter(Boolean).join(" · ");
    const meta = [version, category];
    const leader = plain(event.leaderId ? leaderName(String(event.leaderId)) : "");
    if (leader) meta.push(tr(lang, "Lead {leader}", { leader }));
    const signups = attendingCount(event);
    if (signups) {
        const roles = roleCounts(event);
        meta.push(["tank", "healer", "dps"].map((r) => countText(r, roles[r], lang)).join(", "));
    }
    meta.push(countText("signup", signups, lang));
    if (channel) meta.push(channel);
    if (event.source !== "eventhelper") meta.push("Raid-Helper");
    return [head, `-# ${meta.filter(Boolean).join(" · ")}`].join("\n");
}

/**
 * The upcoming raids, soonest first, grouped by game version (#743, TBC and
 * Forever share the server), then by category. Only configured event
 * categories when there are any; the raids of a version the orga hid
 * (hideOtherVersions) are left out, and so is every version a link does not
 * list (`versions`, #892; empty = all). Each group carries its `versionId`;
 * `versionTitled` says whether more than one version is listed, so the lines
 * name it.
 */
function upcomingGroups(groups, { now = Date.now(), categoryIds = [], versions = [], lang = "de", config } = {}) {
    const allowed = new Set((categoryIds || []).map(String));
    const wanted = new Set((versions || []).map(String).filter(Boolean));
    const nowSec = Math.floor(now / 1000);
    const order = new Map(VERSIONS.map((v, i) => [v.id, i]));
    const byStart = (a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0);
    const out = [];
    for (const g of groups || []) {
        if (allowed.size && !allowed.has(String(g.categoryId || ""))) continue;
        const perVersion = new Map();
        for (const e of g.events || []) {
            if (!e || !e.id || (Number(e.startTime) || 0) < nowSec) continue;
            // a further raid of a raid group (#811): the raiders know the evening by its first raid
            if (isRaidSibling(e)) continue;
            const versionId = versionOfEvent({ ...e, categoryId: e.categoryId || g.categoryId }, { config });
            if (!isVersionVisible(versionId, config)) continue;
            if (wanted.size && !wanted.has(String(versionId))) continue;
            if (!perVersion.has(versionId)) perVersion.set(versionId, []);
            perVersion.get(versionId).push(e);
        }
        for (const [versionId, events] of perVersion) {
            out.push({
                categoryId: g.categoryId || "",
                categoryName: g.categoryName || tr(lang, NO_CATEGORY),
                versionId,
                events: events.sort(byStart),
            });
        }
    }
    const titled = new Set(out.map((g) => g.versionId)).size > 1;
    return out
        .map((g) => ({ ...g, versionTitled: titled }))
        .sort((a, b) => (order.get(a.versionId) - order.get(b.versionId))
            || (Number(a.events[0].startTime) || 0) - (Number(b.events[0].startTime) || 0)
            || a.categoryName.localeCompare(b.categoryName));
}

/**
 * The day fields of the agenda: raids in time order, one field per day, a day
 * that overflows 1024 characters continued in a field without a name. Stops
 * before 25 fields or 6000 characters — the latest raids fall away.
 * @returns {{ fields: object[], shown: number }}
 */
function dayFields(raids, { lang, used, stanza }) {
    const fields = [];
    let total = used;
    let shown = 0;
    let lastDay = "";
    for (const raid of raids) {
        const text = stanza(raid);
        const day = dayKey(raid.startTime);
        const current = fields[fields.length - 1];
        if (current && day === lastDay && current.value.length + RAID_SEP.length + text.length <= MAX_FIELD_VALUE) {
            if (total + RAID_SEP.length + text.length > MAX_EMBED_CHARS - FOOTER_RESERVE) break;
            current.value += RAID_SEP + text;
            total += RAID_SEP.length + text.length;
        } else {
            const name = (day === lastDay ? SPACER : dayHeading(raid.startTime, lang) || SPACER).slice(0, 256);
            const value = text.slice(0, MAX_FIELD_VALUE);
            if (fields.length >= MAX_FIELDS || total + name.length + value.length > MAX_EMBED_CHARS - FOOTER_RESERVE) break;
            fields.push({ name, value, inline: false });
            total += name.length + value.length;
        }
        lastDay = day;
        shown += 1;
    }
    return { fields, shown };
}

/**
 * The message payload (pure — no Discord call).
 * @param {object[]} groups loadEventGroups()'s groups
 * @param {object} opts
 *   `eventGuildId` the source server (`from`), `serverName` its name,
 *   `crossServer` the list sits on another server (channel links name it),
 *   `lang` the frame language ("de" | "en", German by default), `config` for
 *   the category languages of the raid stanzas (without it they speak `lang`),
 *   `versions` the link's version filter, `leaderName(id)` a lead's display
 *   name ("" = leave the lead out)
 * @returns {{ content: string, embeds: object[], components: object[] }} plain API JSON
 */
function buildOverviewMessage(groups, opts = {}) {
    const {
        eventGuildId = "", baseUrl = linkCheck.webBase(), channelInfo = linkCheck.channelInfo,
        lang = "de", config, crossServer = false, leaderName = () => "",
    } = opts;
    const serverName = opts.serverName || opts.eventGuildName || "";
    const list = upcomingGroups(groups, { ...opts, lang });
    const all = list
        .flatMap((g) => g.events.map((e) => ({
            ...e,
            categoryId: e.categoryId || g.categoryId,
            categoryName: g.categoryName,
            versionId: g.versionId,
            versionTitled: g.versionTitled,
        })))
        .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0));
    // Nobody signs up for a cancelled raid (#288): it is shown, not offered.
    const signable = all.filter((e) => e.status !== "cancelled");

    const title = crossServer && serverName
        ? tr(lang, "Raids from {server}", { server: plain(serverName) })
        : tr(lang, "Upcoming raids");
    let description = tr(lang, "No raids are planned right now. New raids show up here by themselves.");
    if (all.length) {
        description = crossServer && serverName
            ? tr(lang, "Updates itself · channel links lead to **{server}**", { server: plain(serverName) })
            : tr(lang, "Updates itself · links lead to the event channel");
    }

    const stanza = (raid) => raidStanza(raid, eventGuildId, {
        baseUrl, channelInfo, serverName, crossServer, leaderName,
        versionTitled: raid.versionTitled,
        lang: config ? eventLang(raid, config) : lang,
    });
    const { fields, shown } = dayFields(all, { lang, used: title.length + description.length, stanza });

    const embed = new EmbedBuilder()
        .setColor(embedAccentColor)
        .setTitle(title)
        .setDescription(description);
    if (fields.length) embed.addFields(fields);
    const missing = all.length - shown;
    if (missing > 0) embed.setFooter({ text: tr(lang, "+{count} more raids in the web overview", { count: missing }) });

    const components = [];
    // Several raids at once (#293) — only EventHelper events take a signup here.
    if (signable.some((e) => e.source === "eventhelper")) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(ALL_BUTTON_ID).setStyle(ButtonStyle.Primary).setLabel(tr(lang, "Sign up for all raids")),
            new ButtonBuilder().setCustomId(MULTI_BUTTON_ID).setStyle(ButtonStyle.Secondary).setLabel(tr(lang, "Pick several raids …")),
        ));
    }
    if (signable.length) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(SELECT_ID)
            .setPlaceholder(tr(lang, "Pick a single raid …"))
            .addOptions(signable.slice(0, MAX_OPTIONS).map((e) => ({
                label: (plain(e.title) || "Raid").slice(0, 100),
                description: [formatStart(e.startTime, lang), plain(e.categoryName)].filter(Boolean).join(" · ").slice(0, 100),
                value: String(e.id).slice(0, 100),
            })));
        components.push(new ActionRowBuilder().addComponents(select));
    }
    // Without PUBLIC_BASE_URL the web buttons would lead nowhere (#537): left out.
    const links = overviewLinks(baseUrl);
    if (links) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(tr(lang, "Web overview")).setURL(links.web),
            new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(tr(lang, "My signups")).setURL(links.signups),
            new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(tr(lang, "My profile")).setURL(links.profile),
        ));
    }

    return {
        content: "",
        embeds: [embed.toJSON()],
        components: components.map((row) => row.toJSON()),
    };
}

/** A stable fingerprint of a payload and its language: same content in the same language, same hash. */
function payloadHash(payload, lang = "") {
    return crypto.createHash("sha1").update(`${lang}|${JSON.stringify(payload)}`).digest("hex");
}

function isUnknownMessage(e) {
    return !!(e && (e.code === 10008 || /unknown message/i.test(e.message || "")));
}

const OVERVIEW_CHANNEL_MISSING = "Übersichts-Kanal nicht gefunden oder kein Textkanal.";

/**
 * Every link as a sync entry (#892): `{ key, legacyKey, guildId: from, from,
 * to, label, overviewGuildId: to, overviewChannelId, lang, versions }`, in
 * link order. `key` = "from:to", the store record of its message.
 */
function overviewEntries(config = getConfig()) {
    return overviewKeys(guildRoles.links(config)).map(({ link, key, legacyKey }) => ({
        key,
        legacyKey,
        guildId: link.from,
        from: link.from,
        to: link.to,
        label: guildRoles.serverLabel(link.from, config),
        overviewGuildId: link.to,
        overviewChannelId: link.channelId,
        lang: link.lang || "",
        versions: Array.isArray(link.versions) ? link.versions : [],
    }));
}

/** A lead's display name from the member cache of the source server — never a fetch (1 vCPU, no GuildMembers wait). */
function cachedLeaderName(guild) {
    return (id) => {
        const member = guild && guild.members && guild.members.cache && typeof guild.members.cache.get === "function"
            ? guild.members.cache.get(id)
            : null;
        return (member && (member.displayName || (member.user && member.user.username))) || "";
    };
}

/**
 * The payload as it would be posted now, for one link — for the sync and the
 * dry run. Without `link` it is the link named by `key` ("from:to") — an
 * unknown key means none, never another link of its source — else the first
 * link of `guildId` (default: the first server), or none: then the
 * list speaks the server language, shows every version and links channels
 * without a server name.
 */
async function currentPayload({
    config = getConfig(), now = Date.now(), guildId = guildRoles.serverIds(config)[0] || "", link = null, key = "",
} = {}) {
    const entries = link ? [] : overviewEntries(config);
    // A key names exactly one link: an unknown key means no link (its source
    // alone), never another link of the same source.
    const entry = link
        || (key ? entries.find((e) => e.key === String(key)) : entries.find((e) => e.from === String(guildId)))
        || null;
    const from = entry ? entry.from : (key ? String(key).split(":")[0] : String(guildId || ""));
    const { groups, error } = await loadEventGroups(from);
    // Confirm every listed channel before a line links it (#537).
    await linkCheck.checkChannels((groups || []).flatMap((g) => (g.events || []).map((e) => ({ guildId: from, channelId: e.channelId }))));
    const guild = discord.getGuild(from);
    const lang = (entry && entry.lang) || serverLang(config);
    const payload = buildOverviewMessage(groups, {
        eventGuildId: from,
        serverName: guildRoles.serverLabel(from, config) || (guild ? guild.name : ""),
        crossServer: !!entry && entry.to !== from,
        now,
        categoryIds: config.categoryIds || [],
        versions: entry ? entry.versions : [],
        config,
        leaderName: cachedLeaderName(guild),
        lang,
    });
    return { payload, error, lang };
}

/** One link's own sync: builds, then edits/reposts/posts its own message, tracked under its `from:to` key. */
async function runSyncOne(entry, { repost = false, now = Date.now(), config = getConfig() } = {}) {
    const base = { key: entry.key, from: entry.from, to: entry.to, guildId: entry.guildId, label: entry.label || "" };
    // The first read moves a pre-#892 record (keyed by `from`) over: its message is edited on, not reposted.
    const state = getOverviewState(entry.key, { legacyKey: entry.legacyKey });
    const fail = (message) => {
        setOverviewState(entry.key, { checkedAt: now, error: message });
        return { ...base, status: "error", error: message };
    };
    try {
        if (!discord.isOnline()) return fail("Bot nicht verbunden.");
        const { payload, error, lang } = await currentPayload({ config, now, link: entry });
        // A Raid-Helper outage would post a list without its events: leave an
        // existing message as it is and try again on the next sweep.
        if (error && state.messageId && !repost) return fail(`Events nicht vollständig ladbar: ${error}`);
        const hash = payloadHash(payload, lang);
        const channel = await discord.fetchTextChannel(entry.overviewChannelId, OVERVIEW_CHANNEL_MISSING);

        const sameChannel = state.messageId && state.channelId === entry.overviewChannelId;
        if (sameChannel && !repost) {
            try {
                const message = await channel.messages.fetch(state.messageId);
                if (state.hash === hash) {
                    setOverviewState(entry.key, { checkedAt: now, error: "" });
                    return { ...base, status: "unchanged", messageId: state.messageId };
                }
                await message.edit(payload);
                setOverviewState(entry.key, { hash, editedAt: now, checkedAt: now, error: "" });
                return { ...base, status: "edited", messageId: state.messageId };
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
        setOverviewState(entry.key, {
            channelId: entry.overviewChannelId, messageId: posted.id, hash,
            postedAt: now, editedAt: 0, checkedAt: now, error: "",
        });
        return { ...base, status: "posted", messageId: posted.id };
    } catch (e) {
        return fail((e && e.message) || "Übersicht konnte nicht aktualisiert werden.");
    }
}

/**
 * With `key` ("from:to"): syncs only that link's list, returning its single
 * result — "unconfigured" when there is no such link. `guildId` (the older
 * form) means the first link of that source. Without either: syncs every link
 * in turn (one link's failure never blocks another's), returning
 * `{ results: [...] }`.
 */
async function runSync({
    repost = false, now = Date.now(), config = getConfig(), guildId = "", key = "",
} = {}) {
    const entries = overviewEntries(config);
    if (key || guildId) {
        const entry = key
            ? entries.find((e) => e.key === String(key))
            : entries.find((e) => e.from === String(guildId));
        if (!entry) return { status: "unconfigured" };
        return runSyncOne(entry, { repost, now, config });
    }
    const results = [];
    for (const entry of entries) results.push(await runSyncOne(entry, { repost, now, config }));
    const pruned = await pruneOrphans(entries);
    return pruned.length ? { results, pruned } : { results };
}

/**
 * Whether the settings file itself was read: a missing or broken config.json
 * reads as the defaults, and an empty link list from that must never look
 * like "every link was removed".
 */
function configReadCleanly() {
    try {
        const stored = readStored();
        return !!(stored && stored.discordServers && typeof stored.discordServers === "object");
    } catch {
        return false;
    }
}

function isMissingChannel(e) {
    return !!(e && (e.code === "channel_not_found" || e.code === 10003 || /unknown channel/i.test(e.message || "")));
}

/**
 * The lists whose link is gone (removed, or its source or target changed —
 * a new key): delete their message and drop the record. Only after a clean
 * config read with at least one link; a message that is already gone (or its
 * channel) counts as deleted, any other failure keeps the record for the next
 * sweep. Records that may still migrate onto a link are never listed
 * (talkOverviewStore.listOverviewKeys). Returns the keys dropped.
 */
async function pruneOrphans(entries) {
    if (!entries.length || !configReadCleanly() || !discord.isOnline()) return [];
    const live = new Set(entries.map((e) => e.key));
    const pruned = [];
    for (const key of listOverviewKeys()) {
        if (live.has(key)) continue;
        const state = getOverviewState(key);
        try {
            if (state.messageId && state.channelId) {
                const channel = await discord.fetchTextChannel(state.channelId, OVERVIEW_CHANNEL_MISSING);
                const message = await channel.messages.fetch(state.messageId);
                await message.delete();
            }
        } catch (e) {
            if (!isUnknownMessage(e) && !isMissingChannel(e)) {
                console.warn("[talkOverview] verwaiste Raid-Liste nicht gelöscht:", key, e.message);
                continue;
            }
        }
        removeOverviewState(key);
        pruned.push(key);
    }
    return pruned;
}

let queue = Promise.resolve();

/**
 * Bring the raid lists (or, with `key`/`guildId`, one link's list) up to
 * date. Runs one at a time, so a sweep and a roster change never post two
 * messages on top of each other.
 * @param {{ repost?: boolean, key?: string, guildId?: string }} opts repost = delete the old message and post a new one
 * @returns {Promise<{ status: "unconfigured"|"unchanged"|"edited"|"posted"|"error", messageId?: string, error?: string }
 *   | { results: object[] }>} a single result with `key`/`guildId`, or `{ results }` over every link without one
 */
function syncOverview(opts = {}) {
    const run = queue.then(() => runSync(opts));
    queue = run.catch(() => {});
    return run;
}

/** Every link's raid-list state, for the settings page. */
function overviewStatus(config = getConfig()) {
    return overviewEntries(config).map((entry) => {
        const state = getOverviewState(entry.key, { legacyKey: entry.legacyKey });
        const active = state.channelId === entry.overviewChannelId && !!state.messageId;
        return {
            key: entry.key,
            from: entry.from,
            to: entry.to,
            guildId: entry.guildId,
            label: entry.label || "",
            lang: entry.lang,
            versions: entry.versions,
            configured: true,
            channelId: entry.overviewChannelId,
            messageId: active ? state.messageId : "",
            messageUrl: active ? linkCheck.messageLink(entry.overviewGuildId, state.channelId, state.messageId) : "",
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
 * Keep the lists current: roster changes (debounced), and a sweep every
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
    SELECT_ID, ALL_BUTTON_ID, MULTI_BUTTON_ID, RAIDHELPER_CREATE_DELAY_MS, CHANNEL_MISSING, currentPayload, syncOverview, overviewStatus,
    scheduleOverviewSync, startTalkOverview, stopTalkOverview,
    // the counter the category overviews (events/raidOverview.js) show as well
    attendingCount,
    // only for the tests (#424): not part of the module's API
    _internal: {
        overviewLinks, formatStart, dayHeading, buildOverviewMessage, payloadHash, overviewEntries, roleCounts, roleOf, instancePart,
    },
};
