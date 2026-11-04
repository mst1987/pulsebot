// The head every ephemeral step of the signup flow shares (Nov 2026, "Steckbrief"): one card, the raid's name and date
// in a section beside its picture, the facts and the selects below over the full width. Only what the event and its
// signups already hold is shown, a value that is missing drops out without a word: no lookups, these cards are built
// right before the answer to a click. The steps themselves live in signupButtons.js, joinPicker.js and signupDialog.js.
//
// The texts are in the reader's language (`lang`): only the member sees these messages.
const { card } = require("../discord/card");
const { colorOf } = require("./signupReply");
const { accountCount, normalizeOverflow } = require("./capacity");
const { tr } = require("../i18n/botText");
const { nameFromSignups, plainName } = require("../discord/mentionName");
const { lookOf, messageLookOf } = require("../../services/events/embedLook");
const { raidPicture } = require("../../services/events/overview/raidOverviewPanel");
const { getConfig } = require("../../stores/settings/settingsStore");
const { listSignups } = require("../../stores/events/signupStore");

/** "<date> <in 3 days>" of the raid's start as Discord timestamps, "" without a start. */
function signupWhen(event) {
    const start = Math.floor(Number(event && event.startTime) || 0);
    return start ? `<t:${start}:f> <t:${start}:R>` : "";
}

/**
 * The picture of a step: as raidPicture (the event's own, else the zone art of its instances), but a category that
 * switched the raid picture off (`raidArt`, Einstellungen › Kategorien) keeps only the event's own. "" when there is none.
 */
function signupPicture(event) {
    if (!event) return "";
    if (messageLookOf(getConfig(), event.categoryId).raidArt) return raidPicture(event);
    return lookOf(event).url || "";
}

/**
 * "12 / 20 signed up", without a size "12 signed up"; "" without a size and without signups. "20 / 20 full" only for a raid
 * with a real limit: without one (`overflow` "none", the default since #516) signups go on and the setup picks who plays.
 */
function signupFill(event, lang, signups = listSignups(event.id)) {
    const count = accountCount(signups);
    const size = Number(event.size) || 0;
    if (!size) return count ? tr(lang, "{count} signed up", { count }) : "";
    const full = count >= size && normalizeOverflow(event.overflow) !== "none";
    return tr(lang, full ? "{count} / {size} full" : "{count} / {size} signed up", { count, size });
}

/** The name the lead signed up with. A lead without a signup stays out: a silent `<@id>` can read "@unknown-user". */
function leadFact(event, lang, signups) {
    const name = plainName(nameFromSignups(signups, event.leaderId));
    return name ? { name: tr(lang, "Lead"), value: name } : null;
}

/** The deadline while it is still ahead. */
function deadlineFact(event, lang, now) {
    const deadline = Math.floor(Number(event.signupDeadline) || 0);
    if (!deadline || deadline <= Math.floor(now / 1000)) return null;
    return { name: tr(lang, "Signup deadline"), value: `<t:${deadline}:f>` };
}

/** The line of a full raid whose new signups go to the waiting list; "" otherwise. */
function waitlistLine(event, lang, signups) {
    const size = Number(event.size) || 0;
    if (!size || normalizeOverflow(event.overflow) !== "waitlist" || accountCount(signups) < size) return "";
    return tr(lang, "The raid is full – new signups go to the waiting list.");
}

/**
 * One step as a card. Without `detail` the facts are the lead alone (class and spec step); with it (the steps that pick
 * a character) also the fill, the deadline and the line of a full raid.
 * @param {object} event  an eventStore event
 * @param {{ lang?: string, now?: number, detail?: boolean, above?: string[], lines?: string[], rows?: object[] }} opts
 *   `above` stands over the divider (what already is), `lines` below it (the question), `rows` under them (selects, buttons)
 */
function stepCard(event, { lang = "de", now = Date.now(), detail = false, above = [], lines = [], rows = [] } = {}) {
    const signups = listSignups(event.id);
    const facts = [leadFact(event, lang, signups)];
    if (detail) facts.push({ name: "", value: signupFill(event, lang, signups) }, deadlineFact(event, lang, now));
    return card({
        color: colorOf(event),
        title: String(event.title || "Raid").slice(0, 256),
        text: signupWhen(event),
        thumbnail: signupPicture(event),
        facts: facts.filter(Boolean),
        parts: [
            detail ? waitlistLine(event, lang, signups) : "",
            ...above,
            "---",
            lines.filter(Boolean).join("\n").trim(),
            ...rows,
        ],
    });
}

module.exports = { signupWhen, signupPicture, signupFill, stepCard };
