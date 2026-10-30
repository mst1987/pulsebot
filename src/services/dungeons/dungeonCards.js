// The Discord cards of the dungeon times (stores/dungeonRunStore.js): the
// answer of /bestzeiten (top runs of one dungeon, or the overall ranking) and
// the post of a new guild record (dungeonRecords.js). Written in English and
// translated with tr() (config/botText/de/dungeons.js); `lang` is the reader's
// for the ephemeral answer and the server's for the public post.
//
// Medals are square emojis (🟨 gold, ⬜ silver, 🟫 bronze) with their word —
// the web shows them as square fields, the bot as close as Discord allows.
const { ButtonBuilder, ButtonStyle } = require("discord.js");
const { card } = require("../../utils/discord/card");
const { webUrl, discordTime, clip } = require("../../utils/discord/botLookup");
const { tr } = require("../../utils/i18n/botText");
const { versionLabel } = require("../versions/versionSettings");
const { formatSeconds } = require("./dungeonBoard");

/** The web page of the dungeon times. */
const PAGE_PATH = "/roster/dungeons";
/** Rows of a card — the page has the rest. */
const CARD_ROWS = 5;
const GOLD_COLOR = 0xd4a72c;

const MEDAL_EMOJI = { gold: "🟨", silver: "⬜", bronze: "🟫" };

/** "Gold" / "Silber" / "Bronze" in the language, "" for no medal. */
function medalWord(lang, medal) {
    if (medal === "gold") return tr(lang, "Gold");
    if (medal === "silver") return tr(lang, "Silver");
    if (medal === "bronze") return tr(lang, "Bronze");
    return "";
}

/** "🟨 Gold" — "" without a medal. */
function medalTag(lang, medal) {
    return medal ? `${MEDAL_EMOJI[medal]} ${medalWord(lang, medal)}` : "";
}

/** The link button to the page. */
function pageButton(lang) {
    return new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(tr(lang, "Open in the web")).setURL(webUrl(PAGE_PATH));
}

/** One run as a line: "**1.** `31:42` · 🟨 Gold · Devira, Thalor · <t:…:d>". */
function runLine(lang, run) {
    const parts = [`**${run.rank}.** \`${formatSeconds(run.seconds)}\``, medalTag(lang, run.medal),
        clip(run.members.map((m) => m.name).join(", "), 120), discordTime(run.startedAt)];
    return parts.filter(Boolean).join(" · ");
}

/** One player of the ranking as a line. */
function playerLine(lang, p) {
    const medals = [
        p.gold ? `${MEDAL_EMOJI.gold} ${tr(lang, "{count} gold", { count: p.gold })}` : "",
        p.silver ? `${MEDAL_EMOJI.silver} ${tr(lang, "{count} silver", { count: p.silver })}` : "",
        p.bronze ? `${MEDAL_EMOJI.bronze} ${tr(lang, "{count} bronze", { count: p.bronze })}` : "",
    ].filter(Boolean).join(" · ");
    const dungeons = p.goldDungeons.length === 1 ? tr(lang, "gold in 1 dungeon") : tr(lang, "gold in {count} dungeons", { count: p.goldDungeons.length });
    return [`**${p.rank}.** **${clip(p.name, 40)}**`, medals || tr(lang, "no medal yet"), p.goldDungeons.length ? dungeons : ""].filter(Boolean).join(" · ");
}

/** "1 run" / "12 runs". */
function runsWord(lang, n) {
    return n === 1 ? tr(lang, "1 run") : tr(lang, "{count} runs", { count: n });
}

/**
 * /bestzeiten <dungeon>: the dungeon's fastest runs; `table` is one entry of
 * dungeonBoard.dungeonTables, or null when the version has no run of it.
 */
function dungeonCard(lang, { versionId, dungeon, table }) {
    const kicker = `${versionLabel(versionId)} · ${tr(lang, "Dungeon best times")}`;
    if (!table) {
        return card({
            kicker, title: clip(dungeon || tr(lang, "Dungeon"), 100),
            text: tr(lang, "No group run of this dungeon is stored yet."),
            buttons: [pageButton(lang)], ephemeral: true,
        });
    }
    return card({
        kind: "info",
        kicker,
        title: table.dungeon,
        text: table.runs.slice(0, CARD_ROWS).map((r) => runLine(lang, r)),
        facts: [
            [tr(lang, "Stored"), runsWord(lang, table.runCount)],
            [tr(lang, "With gold"), runsWord(lang, table.goldRuns)],
        ],
        buttons: [pageButton(lang)],
        ephemeral: true,
    });
}

/** /bestzeiten without a dungeon: the top players by medals. */
function overallCard(lang, { versionId, players, dungeons }) {
    const kicker = `${versionLabel(versionId)} · ${tr(lang, "Dungeon best times")}`;
    if (!players.length) {
        return card({
            kicker, title: tr(lang, "Overall ranking"),
            text: tr(lang, "No group runs stored for {version} yet. They arrive with the sync tool from the LevelHelper addon.", { version: versionLabel(versionId) }),
            buttons: [pageButton(lang)], ephemeral: true,
        });
    }
    return card({
        kind: "info",
        kicker,
        title: tr(lang, "Overall ranking"),
        text: players.slice(0, CARD_ROWS).map((p) => playerLine(lang, p)),
        facts: [[tr(lang, "Dungeons"), String(dungeons)]],
        note: tr(lang, "Pick a dungeon for its best times: /bestzeiten dungeon"),
        buttons: [pageButton(lang)],
        ephemeral: true,
    });
}

/**
 * The public post of a new guild record: a gold run that is now the fastest
 * of its dungeon. `previous` is the time it beat (seconds), 0 for the first.
 */
function recordCard(lang, { versionId, run, previous = 0 }) {
    const text = [`**\`${formatSeconds(run.seconds)}\`** · ${medalTag(lang, run.medal)}`];
    if (previous) text.push(tr(lang, "Previous best: {time}", { time: formatSeconds(previous) }));
    return card({
        color: GOLD_COLOR,
        kicker: `${versionLabel(versionId)} · ${tr(lang, "New guild record")}`,
        title: run.dungeon,
        text,
        facts: [[tr(lang, "Group"), clip(run.members.map((m) => m.name).join(", "), 200)], [tr(lang, "Date"), discordTime(run.startedAt)]],
        buttons: [pageButton(lang)],
    });
}

module.exports = { dungeonCard, overallCard, recordCard, medalWord, runLine, playerLine, PAGE_PATH, CARD_ROWS };
