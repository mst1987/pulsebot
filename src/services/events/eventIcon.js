// The channel icon of /event anlegen: the "Kanal-Icon" select of step 1 and what
// it does to the derived channel name (channelNaming.js).
//
// The choice travels in the customId as a short code — "" (Wie zuletzt), "x"
// (Kein Icon), "r<n>" (n-th suggestion for the template's raids), "c<n>" (n-th
// emoji of the category's channels) — and is never trusted: every click and the
// final create resolve it again against the options as they are *now*, a code
// that no longer exists falls back to "Wie zuletzt".
//
// The edit itself is utils/leadEmoji.js (the twin of the web picker's
// setLeadEmoji): the pick replaces the emoji the name starts with and keeps its
// separator; a name without one gets the emoji and the category's usual separator.

const { raidEmojiSuggestions } = require("../../config/data/raidEmojis");
const { leadEmojiOf, setLeadEmoji, stripLeadEmoji, emojiStyleOf, emojiKey } = require("../../utils/leadEmoji");
const { normalizeChannelName } = require("../../utils/channelNames");

const ICON_NONE = "x";
const ICON_CODE = /^(?:x|[rc]\d{1,2})?$/;
const RAID_MAX = 10;
const CATEGORY_MAX = 12;

/** A code read from anywhere: a known shape or "". */
const cleanIcon = (raw) => (ICON_CODE.test(String(raw || "")) ? String(raw || "") : "");

/**
 * The options of the select, in order: "Wie zuletzt" (what deriving gives),
 * "Passt zu <Raid>", "In dieser Kategorie", "Kein Icon". No emoji twice, at most
 * 25 in all (1 + 10 + 12 + 1).
 *
 * @param {{ derivedName?: string, raidLabel?: string, instanceIds?: string[], categoryNames?: string[] }} p
 * @returns {{ options: { code: string, label: string, emoji: string }[], separator: string }}
 */
function iconOptions({ derivedName = "", raidLabel = "", instanceIds = [], categoryNames = [] } = {}) {
    const style = emojiStyleOf(categoryNames);
    const lastEmoji = leadEmojiOf(derivedName);
    const options = [{ code: "", label: "Wie zuletzt", emoji: lastEmoji }];
    const seen = new Set(lastEmoji ? [emojiKey(lastEmoji)] : []);
    const add = (code, label, emoji) => {
        if (!emoji || seen.has(emojiKey(emoji))) return;
        seen.add(emojiKey(emoji));
        options.push({ code, label, emoji });
    };
    const raidLine = raidLabel ? `Passt zu ${raidLabel}` : "Passt zum Raid";
    raidEmojiSuggestions(instanceIds, RAID_MAX).forEach((e, i) => add(`r${i}`, raidLine, e));
    style.emojis.slice(0, CATEGORY_MAX).forEach((e, i) => add(`c${i}`, "In dieser Kategorie", e));
    options.push({ code: ICON_NONE, label: "Kein Icon", emoji: "" });
    return { options, separator: style.separator };
}

/** The option a code names, else "Wie zuletzt". */
function resolveIcon(options, code) {
    return options.find((o) => o.code === code) || options[0];
}

/** The name with the chosen icon; "Wie zuletzt" leaves it as derived. */
function applyIcon(name, code, { options, separator }, { raw = false } = {}) {
    const choice = resolveIcon(options, code);
    if (choice.code === "") return name;
    const next = choice.code === ICON_NONE ? stripLeadEmoji(name) : setLeadEmoji(name, choice.emoji, separator);
    // `raw`: a pattern with {placeholders} — normalising would strip the braces.
    return raw ? next || name : normalizeChannelName(next) || name;
}

/** The next code after `code` in the list (the cycling button of the duplicate mode). */
function nextIcon(options, code) {
    const at = options.indexOf(resolveIcon(options, code));
    return options[(at + 1) % options.length].code;
}

module.exports = { ICON_NONE, cleanIcon, iconOptions, resolveIcon, applyIcon, nextIcon };
