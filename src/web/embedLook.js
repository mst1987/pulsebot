// The look of the bot's messages for an own event (#307): the coloured bar of
// the embed and the picture beside or below it.
//
// Raid-Helper can colour an event and give it a picture; our signup message was
// the same grey-violet for every raid, so a glance into the channel did not say
// which raid it is. Two fields carry it now, and they are kept **per raid
// template** (raidTemplates.js) rather than per event: the same kind of evening
// then looks the same without anyone maintaining it, and the event inherits a
// copy on creation (eventCreate.templateDefaults) that the create dialog can
// still change for that one night.
//
// Three levels, in this order (`lookOf`):
//   1. the event's own `color` / `image`,
//   2. the rule set of its instances — every instance carries a `color` and its
//      boss `icon` (config/gameVersions), so SSC, BT and Hyjal tell themselves
//      apart with nothing configured at all,
//   3. `embedAccentColor` and no picture.
//
// Where several instances make one evening (SSC + TK) the *leading* one decides:
// the biggest of the night, ties going to the one named first — the same rule
// eventStore.normalizePlan already uses for the tank/healer suggestion.
//
// Two limits the issue names, both enforced here and nowhere else:
//   * a colour is `#rrggbb`, validated on save (colorProblem);
//   * a picture is one **https** URL — Discord fetches it itself, so http, data:
//     and attachment: are refused. A URL that is broken anyway must never keep
//     the message from going out, so `lookOf` drops an unusable one and warns
//     into the log instead of throwing.
//
// Pure apart from that one console.warn: no store, no Discord, no clock.
const { instanceById } = require("../config/gameVersions");
const { wowIconUrl } = require("../config/menu");
const { embedAccentColor } = require("../config/variables");

/** Where a picture goes: beside the text (Discord's `thumbnail`) or under it (`image`). */
const IMAGE_MODES = ["thumbnail", "banner"];
const DEFAULT_IMAGE_MODE = "thumbnail";
// Long enough for any CDN link with a signature, short enough to keep the file small.
const MAX_URL = 500;
const HEX = /^#[0-9a-f]{6}$/;

/**
 * A colour as `#rrggbb` in lower case; "" for anything that is not one (an
 * empty field, a name, a short form). The leading `#` may be left out.
 * @param {*} raw
 * @returns {string}
 */
function normalizeColor(raw) {
    const s = String(raw === null || raw === undefined ? "" : raw).trim().toLowerCase();
    if (!s) return "";
    const hex = s.startsWith("#") ? s : `#${s}`;
    return HEX.test(hex) ? hex : "";
}

/**
 * What is wrong with a colour field as a German sentence, "" when it is fine
 * (an empty field is fine — it means "take the rule set's colour").
 */
function colorProblem(raw) {
    const s = String(raw === null || raw === undefined ? "" : raw).trim();
    if (!s) return "";
    return normalizeColor(s) ? "" : "Die Farbe muss als #rrggbb angegeben werden, z. B. #8a7cff.";
}

/** A `#rrggbb` colour as the integer Discord wants, or null. */
function colorValue(hex) {
    const clean = normalizeColor(hex);
    return clean ? parseInt(clean.slice(1), 16) : null;
}

/** Whether a URL is one Discord may load: absolute, https, with a host. */
function usableUrl(raw) {
    const s = String(raw === null || raw === undefined ? "" : raw).trim();
    if (!s || s.length > MAX_URL) return false;
    let url = null;
    try {
        url = new URL(s);
    } catch {
        return false;
    }
    return url.protocol === "https:" && !!url.hostname;
}

/**
 * A picture field in the stored shape. An unusable URL is dropped here already,
 * so nothing but an https link ever reaches the file.
 * @returns {{ mode: "thumbnail" | "banner", url: string }}
 */
function normalizeImage(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const mode = IMAGE_MODES.includes(src.mode) ? src.mode : DEFAULT_IMAGE_MODE;
    const url = String(src.url === null || src.url === undefined ? "" : src.url).trim();
    return { mode, url: usableUrl(url) ? url : "" };
}

/** What is wrong with a picture field as a German sentence, "" when it is fine. */
function imageProblem(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const url = String(src.url === null || src.url === undefined ? "" : src.url).trim();
    if (src.mode !== undefined && src.mode !== null && src.mode !== "" && !IMAGE_MODES.includes(src.mode)) {
        return "Das Bild muss „thumbnail“ oder „banner“ sein.";
    }
    if (!url) return "";
    if (url.length > MAX_URL) return `Die Bild-Adresse darf höchstens ${MAX_URL} Zeichen lang sein.`;
    return usableUrl(url) ? "" : "Die Bild-Adresse muss mit https:// beginnen.";
}

/**
 * Colour and picture of a template or an event, validated together — the one
 * place both the raid template and the event plan check them.
 * @returns {{ value?: { color: string, image: { mode: string, url: string } }, error?: string }}
 */
function normalizeLook(input = {}) {
    const error = colorProblem(input.color) || imageProblem(input.image);
    if (error) return { error };
    return { value: { color: normalizeColor(input.color), image: normalizeImage(input.image) } };
}

/**
 * The instance that gives an evening its look: the biggest of the night, ties
 * going to the one named first. `null` when none of the ids is known.
 */
function leadInstance(instanceIds) {
    const insts = (Array.isArray(instanceIds) ? instanceIds : []).map((id) => instanceById(id)).filter(Boolean);
    if (!insts.length) return null;
    return insts.reduce((best, i) => ((i.defaultSize || 0) > (best.defaultSize || 0) ? i : best), insts[0]);
}

/**
 * What the rule set contributes when an event sets nothing itself: the leading
 * instance's colour and its boss icon as a thumbnail.
 * @returns {{ color: string, thumbnail: string, instanceId: string }}
 */
function ruleSetLook(instanceIds) {
    const inst = leadInstance(instanceIds);
    if (!inst) return { color: "", thumbnail: "", instanceId: "" };
    return {
        color: normalizeColor(inst.color),
        // 56 px, the largest size the icon CDN has — Discord shows a thumbnail
        // at up to 80 px and never upscales, so it stays crisp.
        thumbnail: inst.icon ? wowIconUrl(inst.icon, 56) : "",
        instanceId: inst.id,
    };
}

/**
 * The look an event's message gets. Colour and picture fall back **on their
 * own**: an event that only sets a colour still gets the rule set's boss icon,
 * and one that only sets a picture keeps the rule set's colour.
 *
 * A stored URL that is not usable (a file edited by hand, a rule tightened
 * later) is dropped with a warning: a picture is never worth a message that
 * does not go out.
 *
 * @param {object} event an eventStore event
 * @returns {{ color: number, colorSource: string, mode: string, url: string, imageSource: string }}
 */
function lookOf(event) {
    const ev = event && typeof event === "object" ? event : {};
    const rules = ruleSetLook(ev.instanceIds);
    const own = normalizeColor(ev.color);
    const image = ev.image && typeof ev.image === "object" ? ev.image : {};
    const rawUrl = String(image.url === null || image.url === undefined ? "" : image.url).trim();
    let url = "";
    if (rawUrl) {
        if (usableUrl(rawUrl)) url = rawUrl;
        else console.warn(`[embedLook] Event ${ev.id || "?"}: Bild-Adresse unbrauchbar, wird weggelassen: ${rawUrl.slice(0, 120)}`);
    }
    const color = own || rules.color;
    return {
        color: colorValue(color) ?? embedAccentColor,
        colorSource: own ? "event" : (rules.color ? "ruleset" : "default"),
        mode: url ? (IMAGE_MODES.includes(image.mode) ? image.mode : DEFAULT_IMAGE_MODE) : "thumbnail",
        url: url || rules.thumbnail,
        imageSource: url ? "event" : (rules.thumbnail ? "ruleset" : "default"),
    };
}

/** Just the colour bar of an event's embed, as Discord's integer. */
function embedColor(event) {
    return lookOf(event).color;
}

/**
 * The picture fields for an embed: `{ thumbnail: { url } }`, `{ image: { url } }`
 * or `{}` when there is none. Spread into the embed.
 */
function embedImageFields(event) {
    const look = lookOf(event);
    if (!look.url) return {};
    return look.mode === "banner" ? { image: { url: look.url } } : { thumbnail: { url: look.url } };
}

module.exports = {
    IMAGE_MODES, DEFAULT_IMAGE_MODE, MAX_URL,
    normalizeColor, colorProblem, colorValue, usableUrl, normalizeImage, imageProblem, normalizeLook,
    leadInstance, ruleSetLook, lookOf, embedColor, embedImageFields,
};
