// The short answers of the signup flow as one embed (#508): "saved", "signed
// off", the waiting list, "this event no longer exists", the service's refusals.
// They used to be plain content lines; now every one is an embed in the colour
// of its raid (services/events/embedLook — the event's own, its instance's, or
// the accent colour), built through utils/discord/reply.buildEmbed so the
// Discord limits are kept in one place.
//
// A text of several lines takes its first line as the title (bold marks
// removed — a title is bold anyway) and the rest as the description; a single
// line stays a description without a title. Every line runs through
// botText.serviceText(lang) first: in English a German service sentence arrives
// in English (botEnglish), in German it stays as the service wrote it. The
// caller hands the reader's language (services/discord/botLanguage.js); without
// one the answer is English, as before the bot spoke German.
const { buildEmbed, embedPayload } = require("../discord/reply");
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

/** An answer (text or buildEmbed input) as the embed object Discord takes. */
function toEmbed(answer, opts = {}) {
    return buildEmbed(typeof answer === "string" ? answerEmbed(answer, opts) : answer);
}

/** The ephemeral reply / follow-up payload of an answer text (or buildEmbed input). */
function answerPayload(answer, { event = null, title = "", components = [], lang = "en" } = {}) {
    return embedPayload(typeof answer === "string" ? answerEmbed(answer, { event, title, lang }) : answer, { components });
}

/**
 * The payload that turns the member's own ephemeral message into the answer:
 * the embed, no components, no leftover text.
 */
function answerUpdate(answer, { event = null, title = "", lang = "en" } = {}) {
    return { content: "", embeds: [toEmbed(answer, { event, title, lang })], components: [] };
}

module.exports = { plainTitle, colorOf, answerEmbed, toEmbed, answerPayload, answerUpdate };
