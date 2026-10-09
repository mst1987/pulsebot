// The short answers of the signup flow as one card (#508, cards since Oct 2026): "saved", "signed off", the waiting list,
// "this event no longer exists", the service's refusals. Each is a card (utils/discord/card.js) in the colour of its raid
// (services/events/embedLook — the event's own, its instance's, or the accent colour); the answer is described as a
// buildEmbed input first (answerEmbed), so the wording rules below stay as they were.
//
// A text of several lines takes its first line as the title (bold marks
// removed — a title is bold anyway) and the rest as the description; a single
// line stays a description without a title. Every line runs through
// botText.serviceText(lang) first: in English a German service sentence arrives
// in English (botEnglish), in German it stays as the service wrote it. The
// caller hands the reader's language (services/discord/botLanguage.js); without
// one the answer is English, as before the bot spoke German.
const { cardFromEmbed } = require("../discord/card");
const { embedColor } = require("../../services/events/embedLook");
const { serviceText } = require("../i18n/botText");

/** A title line without Markdown bold marks. */
const plainTitle = (line) => String(line || "").replace(/\*\*/g, "").trim();

/** The colour of an answer about this event (accent colour without one). */
const colorOf = (event) => (event ? embedColor(event) : undefined);

/**
 * The buildEmbed input of an answer text. `title` sets the title explicitly
 * (then the whole text is the description).
 * @returns {{ title?: string, description: string, color?: number }}
 */
function answerEmbed(text, { event = null, title = "", lang = "en" } = {}) {
    const raw = String(text === null || text === undefined ? "" : text);
    const said = raw.split("\n").map((line) => serviceText(lang, line)).join("\n").trim();
    let head = title;
    let body = said;
    if (!head) {
        const [first, ...rest] = said.split("\n");
        if (rest.length) {
            head = first;
            body = rest.join("\n").trim();
        }
    }
    const out = { description: body || plainTitle(head) };
    if (head && body) out.title = plainTitle(head);
    const color = colorOf(event);
    if (color !== undefined) out.color = color;
    return out;
}

/**
 * The ephemeral reply / follow-up payload of an answer text (or buildEmbed input): one card, `components` (rows or buttons)
 * inside it. A caller adds buttons through `components`, never by overwriting the payload's own `components` or `flags`.
 */
function answerPayload(answer, { event = null, title = "", components = [], lang = "en" } = {}) {
    const spec = typeof answer === "string" ? answerEmbed(answer, { event, title, lang }) : answer;
    return cardFromEmbed(spec, { ephemeral: true, buttons: components });
}

/**
 * The payload that turns the member's own ephemeral message into the answer: the card, no buttons, no leftover text or
 * embed (an update keeps the message's visibility, so no ephemeral flag).
 */
function answerUpdate(answer, { event = null, title = "", lang = "en" } = {}) {
    return cardFromEmbed(typeof answer === "string" ? answerEmbed(answer, { event, title, lang }) : answer);
}

module.exports = { plainTitle, colorOf, answerEmbed, answerPayload, answerUpdate };
