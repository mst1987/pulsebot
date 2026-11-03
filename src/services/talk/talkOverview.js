// The raid list per link (#257, #361, #890, #892): one bot message per link
// (`discordServers.links[]` `{ from, to, channelId, lang, versions }`) in its
// channel on `to`, listing the upcoming raids of `from` by raid (design "B, by
// raid, with raid pictures", replaces the agenda by day D3 of #892). One
// Components V2 container, modelled on Blizzard's group finder:
//   head       "Raids from <server>" and the days of the IDs that occur
//   per kind   one block per kind of raid, soonest first: its zone picture as a
//              thumbnail, its name, the lead when every date shares it, then
//              its dates. A date of this or the next ID is two lines and says
//              "This ID" / "Next ID"; a later one is a single small line. The
//              date links to the public web page, the small line holds fill,
//              channel link and whatever else differs.
//   foot       a green "Pick several raids …", the select, three link buttons
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
// Discord shapes the message: 40 components including the nested ones, 4000
// characters of text, 25 select options (the next 25 raids). Without blocks the
// frame costs 11 components (container, head, the line above the controls, the
// three rows with their five controls), a block with a picture 4 (line, section,
// text, thumbnail), one without 2, the "+N more" line 1: so at most 7 blocks of
// their own (11 + 28 + 1 = 40). From the 8th kind on the first 6 keep theirs and
// the others share one text with their names as small headings (11 + 24 + 2 + 1).
// When the text does not fit, every kind keeps its first date that is not cancelled
// before any kind gets a second, by start time; what is left out is counted in the last line. A
// channel link is always a plain URL — `<#id>` and `<@id>` only resolve on the
// server they are posted on, so a lead is a name from the member cache.
//
// Languages (#892): the frame (head, "+N more", buttons) speaks the link's
// language (`link.lang`, empty = the server language, services/discord/botLanguage.js
// `serverLang`); every raid speaks its category's language (`eventLang`), so a
// PuG raid reads English beside German guild raids. The frame language is hashed
// with the payload, so a change of it redraws the message on the next sync
// (languageChange.js schedules one). What depends on the clock and is meant to
// edit the message, on the first sweep after it happened: "This ID" turning into
// the next one at the reset, a raid that started falling out of the list, and
// the fill turning into "signups closed" past the `signupDeadline`. Nothing else
// may: the rest of a time stands as `<t:…>`, which Discord renders itself.
const crypto = require("crypto");
const { isRaidSibling } = require("../../utils/raidGroup");
const { serverDateTime, discordTimestamp } = require("../../utils/time");
const { raidIdOf, idDistance } = require("../../utils/time/raidId");
const { tr, dateLocale } = require("../../utils/i18n/botText");
const { serverLang, eventLang } = require("../discord/botLanguage");
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder,
    SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder, ThumbnailBuilder,
} = require("discord.js");
const { embedAccentColor } = require("../../config/variables");
const discord = require("../discord/discord");
const linkCheck = require("../discord/linkCheck");
const guildRoles = require("../discord/roles/guildRoles");
const { loadEventGroups } = require("../events/raidEventGroups");
const { leadInstance } = require("../events/embedLook");
const { raidContentIds } = require("../events/overview/raidListing");
const { contentsForText } = require("../../config/data/raidContent");
const {
    dayLabel, fillLine, idTitle, raidPicture, rangeLabel, TEXT_BUDGET,
} = require("../events/overview/raidOverviewPanel");
const { getConfig } = require("../../stores/settings/settingsStore");
const { versionOfEvent, isVersionVisible } = require("../versions/mainVersion");
const { versionShort } = require("../versions/versionTag");
const { VERSIONS, instanceById } = require("../../config/gameVersions");
// The game data holds one name per instance; the web client's catalogue has the English ones.
const { instance: EN_INSTANCE_NAMES } = require("../../web-client/src/i18n/locales/en/wow.json");
const { plainCategoryName } = require("../../utils/signup/availabilityDialog");
const { onSignupsChanged } = require("../../stores/events/signupStore");
const {
    getOverviewState, setOverviewState, overviewKeys, listOverviewKeys, removeOverviewState,
} = require("../../stores/discord/talkOverviewStore");
const { readStored } = require("../../stores/settings/configStore");
const { signupStatus } = require("../../utils/attendance");
const { accountCount } = require("../../utils/signup/capacity");

// What a raid line shows instead of a link to a channel that is gone (#537), in English (tr() translates it).
const CHANNEL_MISSING = "channel missing";
const NO_CATEGORY = "No category";

const SELECT_ID = "talk-signup";
// "Mehrere Raids wählen …" (#293, commands/signup/talkSignupMulti.js); "Für alle Raids" is gone (#904)
const MULTI_BUTTON_ID = "talk-signup-multi";
const MAX_OPTIONS = 25;
// The blocks of their own a message can hold, and how many stay when the kinds do not fit (head comment).
const MAX_BLOCKS = 7;
const BLOCKS_WITH_SHARED_TEXT = 6;
// A category named only by its size ("10er") says nothing the fill does not say.
const SIZE_ONLY_CATEGORY = /^\d+er$/i;
// How much of a raid's own title its small line shows.
const TITLE_MAX = 40;
// What a title says about the date, the size or nothing at all: on its own it is no title worth showing.
const TITLE_NOISE = new RegExp(`^(?:${[
    "(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?(?:raids?)?",
    "mo|di|mi|do|fr|sa|so|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun",
    "januar|january|jan|februar|february|feb|märz|march|mär|mar|april|apr|mai|may|juni|june|jun|juli|july|jul|august|aug",
    "september|sept|sep|oktober|october|okt|oct|november|nov|dezember|december|dez|dec",
    "\\d+(?:er|man|h|uhr|am|pm)?|uhr|pm|raids?|runs?|und|and|plus|am|on|at|um|ab",
].join("|")})$`, "u");
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
 * The channel part of a raid's small line (#537): a link only when the channel
 * exists (linkCheck), "channel missing" as plain text when it is gone, the bare
 * name while nothing is known (bot offline since the start). The name without
 * its decoration ("◜ · raid" reads "raid").
 */
function channelPart(event, eventGuildId, { channelInfo, lang }) {
    if (!event.channelId) return "";
    const name = `#${plainCategoryName(plain(event.channelName)) || "event"}`;
    const info = channelInfo(eventGuildId, event.channelId);
    if (info.state === "missing" && !info.url) return tr(lang, CHANNEL_MISSING);
    return info.url ? `[${name}](${info.url})` : name;
}

/**
 * "Do. 17 Sep. 19:30" / "Thu 17 Sep 19:30" in server time (Berlin); start is
 * unix seconds (or ms). For the select options, which cannot render a Discord
 * timestamp — the text lines use Discord timestamps instead, so every reader
 * sees their own time zone.
 */
function formatStart(startTime, lang = "de") {
    const dt = serverDateTime(startTime);
    return dt ? dt.setLocale(dateLocale(lang)).toFormat("ccc d LLL HH:mm") : "";
}

/** How many single Discord accounts are coming (#520): signed and late, the same count as the event message. */
function attendingCount(event) {
    return accountCount(event.signUps || [], signupStatus);
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
 * An instance's name in a raid's language, without a bracket suffix ("(Forever)"). German is the
 * game data's name, English the catalogue's; an instance missing there falls back to its `short`,
 * never to the German name.
 */
function instanceTitle(instance, lang) {
    const name = lang === "en" ? EN_INSTANCE_NAMES[instance.id] || instance.short : instance.name;
    return plain(name).replace(/\s*\(.*\)$/, "");
}

/** A title reduced for comparing: lower case, no apostrophes (so "Gruul's" reads "gruuls"), no custom emojis. */
function comparable(text) {
    return plain(text).replace(/<a?:\w+:\d+>/g, " ").replace(/['’`´]/g, "").toLowerCase();
}

const wordsOf = (text) => text.match(/[\p{L}\p{N}]+/gu) || [];

/** Every name of an instance a title may use, comparable, each also without its bracket suffix. */
function instancePhrases(instance) {
    return [instance.id, instance.name, EN_INSTANCE_NAMES[instance.id], instance.short, ...(instance.zoneNames || [])]
        .filter(Boolean)
        .flatMap((name) => [name, name.replace(/\s*\(.*\)$/, "")])
        .map(comparable);
}

/** The words of a title that are left once its instances, whatever else names them and the version are taken out. */
function titleLeftover(raid, contentIds) {
    // longest first, so "Hyjal Summit" goes before "Hyjal"
    const phrases = contentIds.flatMap((id) => instancePhrases(instanceById(id)))
        .concat(comparable(versionShort(raid.versionId)))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
    let text = comparable(raid.title);
    for (const phrase of new Set(phrases)) {
        const quoted = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${quoted}(?![\\p{L}\\p{N}])`, "gu"), " ");
    }
    // What only the recognition knows ("KZ", "Das Auge"): one word first, so that "Kara Gear Check" stays "gear check".
    let words = wordsOf(text);
    for (const size of [1, 2, 3]) {
        for (let i = 0; i + size <= words.length;) {
            const hits = contentsForText(words.slice(i, i + size).join(" "), { versionId: raid.versionId });
            if (hits.some((id) => contentIds.includes(id))) words = [...words.slice(0, i), ...words.slice(i + size)];
            else i += 1;
        }
    }
    return words.filter((word) => !TITLE_NOISE.test(word));
}

/**
 * A raid's own title, when it says more than its instances and its date ("Kara Gear-Check", not
 * "Barrow Deeps" or "Hyjal Mittwoch") and more than its category, which stands in the same line.
 */
function ownTitle(raid, contentIds) {
    const left = titleLeftover(raid, contentIds);
    const category = new Set(wordsOf(comparable(plainCategoryName(plain(raid.categoryName)))));
    if (left.every((word) => category.has(word))) return "";
    const title = plain(raid.title);
    return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1).trimEnd()}…` : title;
}

/** What tells this date from the others of its block: the further instances ("+ Karazhan") and its own title. */
function raidNote(raid, contentIds, lead) {
    const further = contentIds.filter((id) => id !== lead.id).map((id) => `+ ${instanceTitle(instanceById(id), raid.lang)}`);
    return [further.join(" "), ownTitle(raid, contentIds)].filter(Boolean);
}

/**
 * The block a raid belongs to: its instance (own events by `instanceIds`, Raid-Helper
 * rows by their title; "SSC + TK" counts as the larger one, leadInstance), else its
 * own title. The version is part of the key: TBC's and Forever's raids never share one.
 */
function blockOf(raid) {
    const { contentIds } = raidContentIds({ title: raid.title, instanceIds: raid.instanceIds, versionId: raid.versionId });
    const instance = leadInstance(contentIds);
    if (instance) return { key: `${raid.versionId}|${instance.id}`, instance, note: raidNote(raid, contentIds, instance) };
    const title = plain(raid.title) || "Raid";
    return { key: `${raid.versionId}|${title.toLowerCase()}`, name: title, instance: null, note: [] };
}

/** The raids (in time order) as blocks, soonest first — a block sits where its first raid does. */
function raidBlocks(raids) {
    const blocks = new Map();
    for (const raid of raids) {
        const { key, name, instance, note } = blockOf(raid);
        if (!blocks.has(key)) blocks.set(key, { name, instance, raids: [], notes: new Map() });
        blocks.get(key).raids.push(raid);
        blocks.get(key).notes.set(raid, note);
    }
    return [...blocks.values()];
}

/** The display name of a raid's lead from the member cache, "" when it has none or is not cached. */
function leadOf(raid, leaderName) {
    return raid.leaderId ? plain(leaderName(String(raid.leaderId))) : "";
}

/** The lead every date of a block shares ("" = they differ, or one has none): it then stands once, at the block. */
function sharedLead(raids, leaderName) {
    const going = raids.filter((r) => r.status !== "cancelled");
    if (!going.length) return "";
    const first = leadOf(going[0], leaderName);
    return going.every((r) => leadOf(r, leaderName) === first) ? first : "";
}

/** The small line of a date: what tells it apart, what it means beyond its size, how full it is, its own lead, its channel. */
function raidFacts(raid, note, ctx, shared) {
    const { lang: frame, now, leaderName } = ctx;
    const lang = raid.lang;
    const category = plainCategoryName(plain(raid.categoryName));
    const named = category && category !== plain(tr(frame, NO_CATEGORY)) && !SIZE_ONLY_CATEGORY.test(category);
    const leader = shared ? "" : leadOf(raid, leaderName);
    return [
        ...note,
        named ? category : "",
        fillLine(raid, attendingCount(raid), lang, now),
        leader ? tr(lang, "Lead {leader}", { leader }) : "",
        channelPart(raid, ctx.eventGuildId, { channelInfo: ctx.channelInfo, lang }),
    ].filter(Boolean);
}

/**
 * One date of a block. This ID and the next: "**This ID** · **[Sat 12.12.](page)** · 20:00" over the
 * small line; a later ID one small line without a mark. A cancelled raid (#288) stays until its
 * day, struck through and marked — without a time, a fill or a link: nobody can sign up anymore.
 */
function dateLines(raid, note, ctx, shared) {
    const { now, baseUrl, eventGuildId, channelInfo } = ctx;
    const lang = raid.lang;
    const start = Math.floor(Number(raid.startTime) || 0);
    const day = dayLabel(start, lang);
    const id = raidIdOf(start * 1000);
    const distance = idDistance(id, now);
    const mark = distance === 0 || distance === 1 ? `**${idTitle(id, now, lang)}**` : "";
    if (raid.status === "cancelled") {
        const small = [...note, channelPart(raid, eventGuildId, { channelInfo, lang })].filter(Boolean);
        const cancelled = tr(lang, "cancelled");
        if (!mark) return `-# ${[`~~${day}~~`, cancelled, ...small].join(" · ")}`;
        return [`${mark} · ~~**${day}**~~ · ${cancelled}`, small.length ? `-# ${small.join(" · ")}` : ""].filter(Boolean).join("\n");
    }
    const page = raid.source === "eventhelper" ? eventUrl(raid.id, baseUrl) : "";
    const date = page ? `[${day}](${page})` : day;
    const time = discordTimestamp(start, "t");
    const facts = raidFacts(raid, note, ctx, shared);
    if (!mark) return `-# ${[date, time, ...facts].join(" · ")}`;
    return `${mark} · ${distance === 0 ? `**${date}**` : date} · ${time}\n-# ${facts.join(" · ")}`;
}

/** The text of a block: its name in its first date's language (with the version once several are listed), then its dates. */
function blockText(block, raids, ctx) {
    const [first] = raids;
    const shared = sharedLead(raids, ctx.leaderName);
    const version = first.versionTitled ? versionShort(first.versionId) : "";
    const name = block.instance ? instanceTitle(block.instance, first.lang) : block.name;
    return [
        `### ${[name, version].filter(Boolean).join(" · ")}`,
        // A title without an instance says nothing about where the raid came from.
        !block.instance && raids.every((r) => r.source !== "eventhelper") ? "-# Raid-Helper" : "",
        shared ? `-# ${tr(first.lang, "Lead {leader}", { leader: shared })}` : "",
        ...raids.map((raid) => dateLines(raid, block.notes.get(raid), ctx, !!shared)),
    ].filter(Boolean).join("\n");
}

/** The head: the list's name and the days of "This ID" / "Next ID" when dates of them are listed. */
function headText(shown, { title, lang, now }) {
    const ids = [...new Set(shown.map((r) => raidIdOf((Number(r.startTime) || 0) * 1000)))]
        .filter((id) => idDistance(id, now) <= 1)
        .sort((a, b) => a - b);
    const days = ids.map((id) => `${idTitle(id, now, lang)} ${rangeLabel(id, lang)}`).join(" · ");
    return [`## ${title}`, days ? `-# ${days}` : ""].filter(Boolean).join("\n");
}

/**
 * The message's text for the raids `shown` (a Set): its head, the blocks that have a date listed
 * (each with the raids it shows) and the text the blocks beyond the limit share.
 */
function drawList(blocks, shown, ctx) {
    const listed = blocks
        .map((block) => ({ block, raids: block.raids.filter((r) => shown.has(r)) }))
        .filter((b) => b.raids.length)
        .map(({ block, raids }) => ({ text: blockText(block, raids, ctx), raids }));
    const own = listed.length > MAX_BLOCKS ? listed.slice(0, BLOCKS_WITH_SHARED_TEXT) : listed;
    const shared = listed.slice(own.length).map((b) => b.text).join("\n");
    const head = headText(listed.flatMap((b) => b.raids), ctx);
    return {
        head,
        own,
        shared,
        length: head.length + shared.length + own.reduce((n, b) => n + b.text.length, 0),
    };
}

/**
 * What fits into the 4000 characters: every kind's first date by start time, then the other dates
 * by start time, until the next one does not fit. Drawn anew per raid, as blocks and lead change
 * with what is listed; it stops at the first raid too many, so this stays around twenty rounds.
 */
function fitList(raids, ctx) {
    const blocks = raidBlocks(raids);
    const byStart = (a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0);
    // A cancelled date only holds its block's place when the block has nothing else.
    const firsts = new Set(blocks.map((b) => b.raids.find((r) => r.status !== "cancelled") || b.raids[0]));
    const others = blocks.flatMap((b) => b.raids.filter((r) => !firsts.has(r)));
    const order = [...[...firsts].sort(byStart), ...others.sort(byStart)];
    const shown = new Set();
    let drawn = drawList(blocks, shown, ctx);
    for (const raid of order) {
        shown.add(raid);
        const next = drawList(blocks, shown, ctx);
        if (next.length > TEXT_BUDGET) {
            shown.delete(raid);
            break;
        }
        drawn = next;
    }
    // A block's picture is the one of its first date, read once: raidPicture warns about a broken address.
    return {
        ...drawn,
        own: drawn.own.map((b) => ({ text: b.text, picture: raidPicture(b.raids[0]) })),
        more: raids.length - shown.size,
    };
}

const textPart = (content) => new TextDisplayBuilder().setContent(content);
const dividerPart = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

/** The controls below the list: the green "several raids" button, the select, the three link buttons into the web. */
function controlRows(raids, { lang, eventGuildId, baseUrl }) {
    const rows = [];
    // Nobody signs up for a cancelled raid (#288): it is shown, not offered.
    const signable = raids.filter((e) => e.status !== "cancelled");
    // Several raids at once (#293) — only EventHelper events take a signup here.
    // The button names the list's server (#904), so it offers this list's raids.
    if (signable.some((e) => e.source === "eventhelper")) {
        const multiId = eventGuildId ? `${MULTI_BUTTON_ID}:${eventGuildId}` : MULTI_BUTTON_ID;
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(multiId).setStyle(ButtonStyle.Success).setLabel(tr(lang, "Pick several raids …")),
        ));
    }
    if (signable.length) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(SELECT_ID)
            .setPlaceholder(tr(lang, "Pick a single raid …"))
            .addOptions(signable.slice(0, MAX_OPTIONS).map((e) => ({
                label: (plain(e.title) || "Raid").slice(0, 100),
                description: [formatStart(e.startTime, lang), plainCategoryName(plain(e.categoryName))].filter(Boolean).join(" · ").slice(0, 100),
                value: String(e.id).slice(0, 100),
            })));
        rows.push(new ActionRowBuilder().addComponents(select));
    }
    // Without PUBLIC_BASE_URL the web buttons would lead nowhere (#537): left out.
    const links = overviewLinks(baseUrl);
    if (links) {
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(tr(lang, "Web overview")).setURL(links.web),
            new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(tr(lang, "My signups")).setURL(links.signups),
            new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(tr(lang, "My profile")).setURL(links.profile),
        ));
    }
    return rows;
}

/**
 * The message payload (pure — no Discord call). The `content` and `embeds` turn a list that
 * is still an embed into this container on the next edit, without a new post.
 * @param {object[]} groups loadEventGroups()'s groups
 * @param {object} opts
 *   `eventGuildId` the source server (`from`), `serverName` its name,
 *   `crossServer` the list sits on another server (the head names it),
 *   `lang` the frame language ("de" | "en", German by default), `config` for
 *   the category languages of the raids (without it they speak `lang`),
 *   `versions` the link's version filter, `leaderName(id)` a lead's display
 *   name ("" = leave the lead out)
 * @returns {{ flags: number, content: "", embeds: [], components: object[], allowedMentions: object }} plain API JSON
 */
function buildOverviewMessage(groups, opts = {}) {
    const {
        eventGuildId = "", baseUrl = linkCheck.webBase(), channelInfo = linkCheck.channelInfo,
        lang = "de", config, crossServer = false, leaderName = () => "", now = Date.now(),
    } = opts;
    const serverName = opts.serverName || opts.eventGuildName || "";
    const list = upcomingGroups(groups, { ...opts, lang, now });
    const all = list
        .flatMap((g) => g.events.map((e) => {
            const raid = {
                ...e,
                categoryId: e.categoryId || g.categoryId,
                categoryName: g.categoryName,
                versionId: g.versionId,
                versionTitled: g.versionTitled,
            };
            return { ...raid, lang: config ? eventLang(raid, config) : lang };
        }))
        .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0));

    const title = crossServer && serverName
        ? tr(lang, "Raids from {server}", { server: plain(serverName) })
        : tr(lang, "Upcoming raids");

    const c = new ContainerBuilder().setAccentColor(embedAccentColor);
    if (all.length) {
        const { head, own, shared, more } = fitList(all, {
            eventGuildId, baseUrl, channelInfo, lang, now, leaderName, title,
        });
        c.addTextDisplayComponents(textPart(head));
        for (const block of own) {
            c.addSeparatorComponents(dividerPart());
            if (block.picture) {
                c.addSectionComponents(new SectionBuilder()
                    .addTextDisplayComponents(textPart(block.text))
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(block.picture)));
            } else {
                c.addTextDisplayComponents(textPart(block.text));
            }
        }
        if (shared) {
            c.addSeparatorComponents(dividerPart());
            c.addTextDisplayComponents(textPart(shared));
        }
        if (more > 0) c.addTextDisplayComponents(textPart(`-# ${tr(lang, "+{count} more in the web overview", { count: more })}`));
    } else {
        c.addTextDisplayComponents(textPart(`## ${title}\n${tr(lang, "No raids are planned right now. New raids show up here by themselves.")}`));
    }

    const rows = controlRows(all, { lang, eventGuildId, baseUrl });
    if (rows.length) {
        c.addSeparatorComponents(dividerPart());
        c.addActionRowComponents(rows);
    }

    return {
        flags: MessageFlags.IsComponentsV2,
        components: [c.toJSON()],
        content: "",
        embeds: [],
        allowedMentions: { parse: [] },
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
    // without a link language: the language of the server the list is posted on (#924, per server)
    const lang = (entry && entry.lang) || serverLang(config, entry ? entry.to : from);
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
    SELECT_ID, MULTI_BUTTON_ID, RAIDHELPER_CREATE_DELAY_MS, CHANNEL_MISSING, currentPayload, syncOverview, overviewStatus,
    scheduleOverviewSync, startTalkOverview, stopTalkOverview,
    // the counter the category overviews (events/overview/raidOverview.js) show as well
    attendingCount,
    // only for the tests (#424): not part of the module's API
    _internal: {
        overviewLinks, formatStart, buildOverviewMessage, payloadHash, overviewEntries, instanceTitle,
    },
};
