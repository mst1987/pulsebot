// The raid overview of a category as a Discord message (design "C", Oct 2026) - a
// pure builder; services/events/raidOverview.js gathers the data, posts and
// redraws it.
//
// One Components V2 container in the bot's accent colour, no buttons:
//   heading       the category's name
//   per raid ID   (lockout week Wednesday to Tuesday, utils/time/raidId.js)
//                 "This ID" / "Next ID" / "ID" and its range "Wed 14.10. – Tue 20.10.",
//                 then per raid a Section: three lines of text and the zone picture as its
//                 thumbnail (the event's own image first, else the zone art of its instances;
//                 a raid without a picture is a plain text display):
//                   **Sat 18.10.** · **Title** · [clock] <t:start:t> · <t:start:R>
//                   <#channel> · [crown] led by <@leader>
//                   -# [fill bar of five app emojis] 17 / 25 signed up
//   footer        "Updates itself · last change <t:…:t>"
//
// Raids that began and cancelled ones are left out. Discord allows 40 components
// (a Section with its text and thumbnail counts 3) and 4000 characters of text per
// Components V2 message: at most MAX_IDS IDs and MAX_RAIDS raids are listed, fewer when
// the component or text budget runs out (plus a "+n more" line).
//
// The texts speak the language of the category (botLanguage.categoryLang).
// Nothing time-dependent goes into the part the hash is taken over: the footer's
// "last change" is added only when `lastChange` is given, and the hash of a
// message is that of the payload built without it (payloadHash).
const crypto = require("crypto");
const {
    ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SectionBuilder, SeparatorBuilder,
    SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} = require("discord.js");
const { DateTime } = require("luxon");
const { embedAccentColor } = require("../../config/variables");
const { tr, dateLocale } = require("../../utils/i18n/botText");
const { serverDateTime } = require("../../utils/time");
const { raidIdOf, idDistance, raidIdRange } = require("../../utils/time/raidId");
const { plainCategoryName } = require("../../utils/signup/availabilityDialog");
const { emojiText, uiEmojiName, appEmojiMap } = require("../discord/appEmojis");
const { lookOf, ruleSetLook, usableUrl } = require("./embedLook");
const { raidContentIds } = require("./raidListing");
const { raidWeekStripSvg } = require("./raidWeekStrip");

const MAX_IDS = 3;
const MAX_RAIDS = 15;
/** Discord: 40 components in all of one Components V2 message, the container and every nested one included. */
const MAX_COMPONENTS = 40;
/** The bar: five segments; below this share of the places it is grey, full is orange, in between green. */
const BAR_SEGMENTS = 5;
const BAR_LOW = 1 / 3;
const BAR_FALLBACK = { g: "🟩", o: "🟧", n: "⬜", e: "▫️" };
/** Discord: 4000 characters of text in all text displays of one message; some room is left for the footer. */
const TEXT_BUDGET = 3700;

const text = (content) => new TextDisplayBuilder().setContent(content);
const line = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

/** Markdown that would break a line (bold, links) taken out of a title. */
function plain(value) {
    return String(value || "").replace(/[*_`~|[\]\\]/g, "").replace(/\s+/g, " ").trim();
}

/** An app emoji of the UI set as text, the fallback (may be "") while it is not uploaded. */
function icon(emojis, name, fallback = "") {
    return emojiText(emojis, uiEmojiName(name), fallback);
}

/**
 * The picture of a raid: its own image first, else the zone art of its instances (as the signup
 * message shows it). Raid-Helper rows have no instance ids, so they are read from the title.
 * "" when there is none or it is not an absolute https URL (Discord refuses anything else).
 */
function raidPicture(event) {
    const own = lookOf(event).url;
    if (own) return own;
    const ids = raidContentIds({ title: event.title, instanceIds: event.instanceIds, versionId: event.versionId }).contentIds;
    const art = ruleSetLook(ids).art;
    return usableUrl(art) ? art : "";
}

/**
 * The fill bar: five segments, as many filled as the signups fill the places (at least one
 * once somebody is in). Orange when full, grey while under a third, otherwise green.
 * "" without a size (Raid-Helper rows).
 */
function fillBar(event, counts, emojis) {
    const size = Number(event.size) || 0;
    if (!size) return "";
    const share = Math.min(1, Math.max(0, counts / size));
    const filled = counts > 0 ? Math.max(1, Math.round(share * BAR_SEGMENTS)) : 0;
    const kind = share >= 1 ? "o" : share < BAR_LOW ? "n" : "g";
    const seg = (k) => icon(emojis, `bar${k}`, BAR_FALLBACK[k]);
    return seg(kind).repeat(filled) + seg("e").repeat(BAR_SEGMENTS - filled);
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
function raidLines(event, { lang, now, attending, emojis }) {
    const start = Math.floor(Number(event.startTime) || 0);
    const title = plain(event.title) || "Raid";
    const counts = attending(event);
    const day = dayLabel(start, lang);
    const head = [day && `**${day}**`, title && `**${title}**`,
        `${icon(emojis, "time")} <t:${start}:t>`.trim(), `<t:${start}:R>`].filter(Boolean).join(" · ");
    const where = [
        event.channelId ? `<#${event.channelId}>` : "",
        event.leaderId ? `${icon(emojis, "leader")} ${tr(lang, "led by {leader}", { leader: `<@${event.leaderId}>` })}`.trim() : "",
    ].filter(Boolean).join(" · ");
    const fill = [fillBar(event, counts, emojis), fillLine(event, counts, lang, now)].filter(Boolean).join(" ");
    return [head, where, `-# ${fill}`].filter(Boolean).join("\n");
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
 * @param {object} [o.emojis] name -> app emoji (appEmojis.appEmojiMap()); missing ones fall back to unicode / nothing
 * @param {number} [o.lastChange] unix seconds for the footer; 0 leaves the time out (what the hash is taken over)
 * @param {boolean} [o.weekStrip] draw each ID's week as a picture above its raids (raidWeekStrip.js); the
 *   payload then carries `images: [{ name, svg }]` for services/discord/discordImage.js `withImages`
 * @returns {{ flags: number, components: object[], embeds: [], content: "", images?: object[] }} API JSON
 */
function raidOverviewPayload({ categoryName = "", events = [], now = Date.now(), lang = "de", attending, lastChange = 0, emojis = appEmojiMap(), weekStrip = false } = {}) {
    const c = new ContainerBuilder().setAccentColor(embedAccentColor);
    const heading = `## ${plainCategoryName(categoryName) || tr(lang, "Raids")}`;
    c.addTextDisplayComponents(text(heading));
    let used = heading.length;
    let components = 4; // container, heading, footer separator + footer text

    const groups = groupByRaidId(events, now);
    const total = groups.reduce((n, g) => n + g.events.length, 0);
    let shown = 0;
    let listedIds = 0;
    const images = [];
    if (!groups.length) {
        const none = tr(lang, "No raids are planned right now. New raids show up here by themselves.");
        c.addTextDisplayComponents(text(none));
        used += none.length;
    }
    for (const group of groups) {
        if (listedIds >= MAX_IDS || shown >= MAX_RAIDS) break;
        const title = `${icon(emojis, "date")} **${idTitle(group.id, now, lang)}** · ${rangeLabel(group.id, lang)}`.trim();
        const rows = [];
        let length = title.length;
        let cost = 2; // separator + the ID's title
        for (const event of group.events) {
            if (shown + rows.length >= MAX_RAIDS) break;
            const block = raidLines(event, { lang, now, attending, emojis });
            const picture = raidPicture(event);
            const rowCost = picture ? 3 : 1;
            if (used + length + block.length + 2 > TEXT_BUDGET - 80) break;
            if (components + cost + rowCost > MAX_COMPONENTS) break;
            rows.push({ block, picture, event });
            length += block.length + 2;
            cost += rowCost;
        }
        if (!rows.length) break;
        c.addSeparatorComponents(line());
        if (weekStrip) {
            // The picture carries the ID's title and range, so it takes the title line's place (same component count).
            const name = `raid-id-${listedIds + 1}.png`;
            const strip = raidWeekStripSvg({
                id: group.id, events: rows.map((r) => r.event), title: idTitle(group.id, now, lang), range: rangeLabel(group.id, lang),
                now, lang, attending,
            });
            images.push({ name, svg: strip.svg });
            c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(`attachment://${name}`).setDescription(strip.alt),
            ));
        } else {
            c.addTextDisplayComponents(text(title));
        }
        for (const { block, picture } of rows) {
            if (picture) {
                c.addSectionComponents(new SectionBuilder()
                    .addTextDisplayComponents(text(block))
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(picture)));
            } else {
                c.addTextDisplayComponents(text(block));
            }
        }
        used += length;
        components += cost;
        shown += rows.length;
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
    const payload = { flags: MessageFlags.IsComponentsV2, components: [c.toJSON()], embeds: [], content: "" };
    if (images.length) payload.images = images;
    return payload;
}

/**
 * The fingerprint of an overview: its components built without the "last change" time, and the
 * pictures' SVGs (an image can change while its text does not - today's mark moves on).
 */
function payloadHash(payload, lang = "") {
    const pictures = (payload.images || []).map((img) => img.svg).join("|");
    return crypto.createHash("sha1").update(`${lang}|${JSON.stringify(payload.components)}${pictures ? `|${pictures}` : ""}`).digest("hex").slice(0, 16);
}

module.exports = { raidOverviewPayload, payloadHash, groupByRaidId, rangeLabel, dayLabel, fillLine, fillBar, raidPicture, MAX_IDS, MAX_RAIDS, MAX_COMPONENTS };
