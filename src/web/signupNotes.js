// The message with "Vielleicht" / "Absagen": a raider who picks one of the two
// may leave a short note, and the bot posts it into one channel the orga reads
// (Einstellungen → Verbindungen → Discord-Server, `discordServers.signupNoteChannelId`).
// A category may name its own channel instead (`config.categorySignupNoteChannel`,
// #335, Einstellungen → Kategorien); one the bot cannot reach falls back to the
// default (noteChannelFor).
//
// Per Discord category the orga decides whether that note is asked for
// (`config.categorySignupNotes`):
//
//   "required"  the modal insists on a note (min. 2 characters)
//   "optional"  the modal asks, an empty note is fine — the default
//   "none"      no modal, nothing is posted
//
// The post happens in signupService.submitSignup(), so the web signup and every
// Discord path share it. It never blocks or fails a signup: posting is
// fire-and-forget and a refused post is only logged.
const discord = require("../services/discord/discord");
const { getConfig } = require("../stores/settingsStore");
const profiles = require("../stores/raiderProfileStore");
const { appEmojiMap, emojiText, statusEmojiName } = require("../services/discord/appEmojis");
const { messageUrl } = require("./eventAnnounce");
const { embedAccentColor } = require("../config/variables");
const { isSnowflake } = require("../utils/ids");

const NOTE_MODES = ["required", "optional", "none"];
const NOTE_STATUSES = ["tentative", "absence"];
const MIN_NOTE = 2;
const MAX_NOTE = 100;
// What the post calls the status (raider-facing bot text is English).
const STATUS_TEXT = { tentative: "Tentative", absence: "Absent" };

/** The category's note mode: "required" | "optional" | "none" (missing = "optional"). */
function noteMode(categoryId, config = getConfig()) {
    const mode = ((config && config.categorySignupNotes) || {})[String(categoryId || "")];
    return NOTE_MODES.includes(mode) ? mode : "optional";
}

/** Whether a status asks for a note at all. */
const isNoteStatus = (status) => NOTE_STATUSES.includes(status);

/** The channel the notes go to, or "". */
function noteChannelId(config = getConfig()) {
    return String(((config && config.discordServers) || {}).signupNoteChannelId || "").trim();
}


/**
 * The channel a category's notes go to: its own channel (#335) when it has one
 * the bot can reach, else the default, else "" (nothing is posted). `reachable`
 * is an optional check of a channel id; without it every own channel counts.
 */
function noteChannelFor(categoryId, config = getConfig(), { reachable } = {}) {
    const own = String(((config && config.categorySignupNoteChannel) || {})[String(categoryId || "")] || "").trim();
    if (isSnowflake(own) && (typeof reachable !== "function" || reachable(own))) return own;
    return noteChannelId(config);
}

/**
 * Whether this save carries a note worth posting: a note status with a
 * non-empty comment, and either the status or the comment changed — so editing
 * something else, or saving the same again, never posts twice.
 */
function hasNewNote(previous, signup) {
    if (!signup || !isNoteStatus(signup.status)) return false;
    const note = String(signup.comment || "").trim();
    if (!note) return false;
    if (!previous) return true;
    return previous.status !== signup.status || String(previous.comment || "").trim() !== note;
}

/** The first character's name as the profile spells it, else the stored key. */
function characterName(signup) {
    const key = String((signup && signup.character) || "");
    if (!key) return "";
    const profile = profiles.getProfile(signup.userId);
    const ch = ((profile && profile.characters) || []).find((c) => c.key === profiles.characterKey(key));
    return ch ? ch.name : key;
}

/** Markdown, mentions and links out of a raider's text — it is shown as they typed it, nothing more. */
function plainText(text) {
    return String(text || "")
        .replace(/[\\*_~`|>[\]()]/g, (c) => `\\${c}`)
        .replace(/@/g, "@​")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * The post: one embed shaped like Raid-Helper's own signup notification (title
 * bar "Notification received!", who signed up as what with their reason, and
 * a closing line with the raid). `<@id>` shows the name; discord.postNotice
 * pings nobody. Returned as `{ embeds: [...] }`, ready for `discord.postNotice`.
 */
function buildNotePost(event, signup, { emojis = {} } = {}) {
    const title = plainText((event && event.title) || "Raid") || "Raid";
    const url = messageUrl(event);
    const start = Number(event && event.startTime) || 0;
    const icon = emojiText(emojis, statusEmojiName(signup.status));
    const mention = `<@${signup.userId}>`;
    const who = [mention, characterName(signup) ? `(${plainText(characterName(signup))})` : ""].filter(Boolean).join(" ");
    const raidLink = url ? `[${title}](${url})` : title;
    const footer = [mention, "|", `**${raidLink}**`, start ? `<t:${start}:f>` : ""].filter(Boolean).join(" ");
    const headline = [`**${who}**`, "signed up as", icon, `**${STATUS_TEXT[signup.status] || signup.status}**`, "with the following reason:"].filter(Boolean).join(" ");
    const description = [
        headline,
        "",
        plainText(signup.comment).slice(0, MAX_NOTE * 3),
        "",
        footer,
    ].join("\n");
    return { embeds: [{ color: embedAccentColor, title: "Notification received!", description }] };
}

/**
 * Post the note of a save, when there is one and the category and channel ask
 * for it. Never throws.
 * @returns {Promise<{ posted: boolean, skipped?: string, error?: string }>}
 *   `skipped`: "no_note" | "by_orga" | "off" | "no_channel"
 */
async function postSignupNote(event, signup, previous, { config = getConfig(), byOrga = false } = {}) {
    if (!hasNewNote(previous, signup)) return { posted: false, skipped: "no_note" };
    // The orga changing someone's signup is no message from that raider.
    if (byOrga) return { posted: false, skipped: "by_orga" };
    if (noteMode(event && event.categoryId, config) === "none") return { posted: false, skipped: "off" };
    const channelId = noteChannelFor(event && event.categoryId, config, { reachable: discord.channelVisible });
    if (!channelId) return { posted: false, skipped: "no_channel" };
    const post = buildNotePost(event, signup, { emojis: appEmojiMap() });
    // A category's own channel that refuses the post (gone, no rights) falls
    // back to the default channel, so the message is not lost silently.
    const fallback = noteChannelId(config);
    const targets = [...new Set([channelId, fallback].filter(Boolean))];
    let error = "";
    for (const target of targets) {
        try {
            await discord.postNotice(target, post);
            return { posted: true, channelId: target };
        } catch (e) {
            error = (e && e.message) || String(e);
            console.warn(`[signupNotes] Nachricht für ${event && event.id} nicht in ${target} gepostet: ${error}`);
        }
    }
    return { posted: false, error };
}

module.exports = {
    NOTE_MODES, NOTE_STATUSES, MIN_NOTE, MAX_NOTE,
    noteMode, isNoteStatus, noteChannelId, noteChannelFor, hasNewNote, buildNotePost, postSignupNote,
};
