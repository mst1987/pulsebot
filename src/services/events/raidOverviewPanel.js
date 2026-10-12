// The raid overview of a category as a Discord message (design "C", Oct 2026) - a
// pure builder; services/events/raidOverview.js gathers the data, posts and
// redraws it.
//
// One Components V2 container in the bot's accent colour, no buttons:
//   heading       the category's name
//   per raid ID   (lockout week Wednesday to Tuesday, utils/time/raidId.js)
//                 "This ID" / "Next ID" / "ID" and its range "Wed 14.10. – Tue 20.10.",
//                 then per raid three lines:
//                   Sat 18.10. · **Title** · <t:start:t> · <t:start:R>
//                   <#channel> · led by <@leader>
//                   -# 17 / 25 signed up
//   footer        "Updates itself · last change <t:…:t>"
//
// Raids that began and cancelled ones are left out. Discord allows 40 components
// and 4000 characters of text per Components V2 message: at most MAX_IDS IDs and
// MAX_RAIDS raids are listed (plus a "+n more" line), and the text is cut short of the limit.
//
// The texts speak the language of the category (botLanguage.categoryLang).
// Nothing time-dependent goes into the part the hash is taken over: the footer's
// "last change" is added only when `lastChange` is given, and the hash of a
// message is that of the payload built without it (payloadHash).
const crypto = require("crypto");
const {
    ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder,
} = require("discord.js");
const { DateTime } = require("luxon");
const { embedAccentColor } = require("../../config/variables");
const { tr, dateLocale } = require("../../utils/i18n/botText");
const { serverDateTime } = require("../../utils/time");
const { raidIdOf, idDistance, raidIdRange } = require("../../utils/time/raidId");
const { plainCategoryName } = require("../../utils/signup/availabilityDialog");

const MAX_IDS = 3;
const MAX_RAIDS = 15;
/** Discord: 4000 characters of text in all text displays of one message; some room is left for the footer. */
const TEXT_BUDGET = 3700;

const text = (content) => new TextDisplayBuilder().setContent(content);
const line = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

/** Markdown that would break a line (bold, links) taken out of a title. */
function plain(value) {
    return String(value || "").replace(/[*_`~|[\]\\]/g, "").replace(/\s+/g, " ").trim();
}

/** "Sat 18.10." - weekday and date of a unix-seconds time in server time, in the language. */
function dayLabel(seconds, lang) {
    const dt = serverDateTime(seconds);
    return dt ? dt.setLocale(dateLocale(lang)).toFormat("ccc dd.LL.") : "";
}

/** "Wed 14.10. – Tue 20.10." - the days of a raid ID. */
function rangeLabel(id, lang) {
    const { from, to } = raidIdRange(id);
    const fmt = (ms) => DateTime.fromMillis(ms, { zone: "utc" }).setLocale(dateLocale(lang)).toFormat("ccc dd.LL.");
    return `${fmt(from)} – ${fmt(to)}`;
}

/** The title of an ID group: the running one, the next one, any other. */
function idTitle(id, now, lang) {
    const distance = idDistance(id, now);
    if (distance === 0) return tr(lang, "This ID");
    if (distance === 1) return tr(lang, "Next ID");
    return tr(lang, "ID");
}

/**
 * How full a raid is, from what the row knows: "signups closed", "10 / 10 full · waiting list open",
 * "17 / 25 signed up", or just "17 signed up" without a size (Raid-Helper rows have none).
 * `counts` = the accounts that are coming (talkOverview's attendingCount).
 */
function fillLine(event, counts, lang, now) {
    const size = Number(event.size) || 0;
    const deadline = Number(event.signupDeadline) || 0;
    if (event.signupsClosed === true || (deadline && Math.floor(now / 1000) > deadline)) return tr(lang, "signups closed");
    if (!size) return tr(lang, "{count} signed up", { count: counts });
    if (counts >= size) {
        const full = tr(lang, "{count} / {size} full", { count: counts, size });
        return event.overflow === "waitlist" ? `${full} · ${tr(lang, "waiting list open")}` : full;
    }
    return tr(lang, "{count} / {size} signed up", { count: counts, size });
}

/** The three lines of one raid. */
function raidLines(event, { lang, now, attending }) {
    const start = Math.floor(Number(event.startTime) || 0);
    const title = plain(event.title) || "Raid";
    const head = [dayLabel(start, lang), `**${title}**`, `<t:${start}:t>`, `<t:${start}:R>`].filter(Boolean).join(" · ");
    const where = [
        event.channelId ? `<#${event.channelId}>` : "",
        event.leaderId ? tr(lang, "led by {leader}", { leader: `<@${event.leaderId}>` }) : "",
    ].filter(Boolean).join(" · ");
    return [head, where, `-# ${fillLine(event, attending(event), lang, now)}`].filter(Boolean).join("\n");
}

/**
 * The upcoming raids as groups by raid ID, soonest first: not begun yet, not cancelled.
 * @returns {{ id: number, events: object[] }[]}
 */
function groupByRaidId(events, now) {
    const nowSec = Math.floor(now / 1000);
    const rows = (events || [])
        .filter((e) => e && e.status !== "cancelled" && (Number(e.startTime) || 0) >= nowSec)
        .sort((a, b) => Number(a.startTime) - Number(b.startTime));
    const groups = new Map();
    for (const e of rows) {
        const id = raidIdOf(Number(e.startTime) * 1000);
        if (!groups.has(id)) groups.set(id, { id, events: [] });
        groups.get(id).events.push(e);
    }
    return [...groups.values()].sort((a, b) => a.id - b.id);
}

/**
 * The overview of one category.
 * @param {object} o
 * @param {string} [o.categoryName] Discord's name, decoration and all
 * @param {object[]} [o.events] the category's raids (loadEventGroups rows), any order
 * @param {number} [o.now] ms
 * @param {string} [o.lang] "de" | "en"
 * @param {(event: object) => number} o.attending how many accounts are coming (talkOverview's attendingCount)
 * @param {number} [o.lastChange] unix seconds for the footer; 0 leaves the time out (what the hash is taken over)
 * @returns {{ flags: number, components: object[], embeds: [], content: "" }} API JSON
 */
function raidOverviewPayload({ categoryName = "", events = [], now = Date.now(), lang = "de", attending, lastChange = 0 } = {}) {
    const c = new ContainerBuilder().setAccentColor(embedAccentColor);
    const heading = `## ${plainCategoryName(categoryName) || tr(lang, "Raids")}`;
    c.addTextDisplayComponents(text(heading));
    let used = heading.length;

    const groups = groupByRaidId(events, now);
    const total = groups.reduce((n, g) => n + g.events.length, 0);
    let shown = 0;
    let listedIds = 0;
    if (!groups.length) {
        const none = tr(lang, "No raids are planned right now. New raids show up here by themselves.");
        c.addTextDisplayComponents(text(none));
        used += none.length;
    }
    for (const group of groups) {
        if (listedIds >= MAX_IDS || shown >= MAX_RAIDS) break;
        const title = `**${idTitle(group.id, now, lang)}** · ${rangeLabel(group.id, lang)}`;
        const lines = [title];
        let length = title.length;
        let taken = 0;
        for (const event of group.events) {
            if (shown + taken >= MAX_RAIDS) break;
            const block = raidLines(event, { lang, now, attending });
            if (used + length + block.length + 2 > TEXT_BUDGET - 80) break;
            lines.push(block);
            length += block.length + 2;
            taken += 1;
        }
        if (!taken) break;
        c.addSeparatorComponents(line());
        c.addTextDisplayComponents(text(lines.join("\n\n")));
        used += length;
        shown += taken;
        listedIds += 1;
    }

    const more = total - shown;
    const footer = [];
    if (more > 0) footer.push(tr(lang, "+{count} more raids", { count: more }));
    footer.push(lastChange
        ? tr(lang, "Updates itself · last change {time}", { time: `<t:${Math.floor(lastChange)}:t>` })
        : tr(lang, "Updates itself"));
    c.addSeparatorComponents(line());
    c.addTextDisplayComponents(text(footer.map((f) => `-# ${f}`).join("\n")));
    return { flags: MessageFlags.IsComponentsV2, components: [c.toJSON()], embeds: [], content: "" };
}

/** The fingerprint of an overview: its components built without the "last change" time. */
function payloadHash(payload, lang = "") {
    return crypto.createHash("sha1").update(`${lang}|${JSON.stringify(payload.components)}`).digest("hex").slice(0, 16);
}

module.exports = { raidOverviewPayload, payloadHash, groupByRaidId, rangeLabel, dayLabel, fillLine, MAX_IDS, MAX_RAIDS };
