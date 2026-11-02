// What the roster picture is drawn from ("Roster als Bild", docs/roster-profile.md): the
// roster page's own detail view (rosterView.buildRosterDetail) turned into the model of the
// pure builder services/roster/rosterImage.js. Reading the detail keeps the picture and the
// page in step - the same first character with the same resolved spec and role. The picture is
// always drawn in the readers' view (the slim rows of rosterView.slimMember, no trial dates),
// whoever makes it: the orga downloads and posts it for the raiders.
//
// Only the first char of a person is a row; the further chars ride along as icons. A person
// without a char shows the linked Kader's planned class under their Discord name. A spec the
// rule set does not know (a log's spec name in the character cache) is dropped to "", so the
// builder falls back to the class icon instead of guessing.
const crypto = require("crypto");
const { buildRosterDetail } = require("./rosterView");
const { specRecord } = require("../../services/roster/memberSpec");
const { categoryLang } = require("../../services/discord/botLanguage");
const { rosterImageSvg, longDate } = require("../../services/roster/rosterImage");
const { renderPng } = require("../../services/discord/discordImage");
const { tr } = require("../../utils/i18n/botText");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** The rule-set spec key of a character, "" when the version does not know it. */
function knownSpec(char, versionId) {
    const spec = str(char && char.spec);
    return spec && specRecord(spec, versionId) ? spec : "";
}

/** One person of the detail view as the builder draws them. */
function personOf(row, versionId) {
    const chars = Array.isArray(row.chars) ? row.chars : [];
    const first = chars[0] || row.planned || {};
    const spec = knownSpec(first, versionId);
    const rec = spec ? specRecord(spec, versionId) : null;
    return {
        name: str(first.name) || str(row.displayName) || str(row.userId),
        status: row.status,
        classId: str(first.className),
        color: str(first.classColor),
        spec,
        specRole: rec ? rec.role : "",
        role: str(row.role),
        extraChars: chars.slice(1).map((c) => ({ classId: str(c.className), color: str(c.classColor), spec: knownSpec(c, versionId) })),
    };
}

/**
 * The builder's model from a roster detail view (pure).
 * @param {object} view rosterView.buildRosterDetail's answer
 * @param {{ now?: number }} [o] the "Stand" date
 */
function modelFromDetail(view, { now = Date.now() } = {}) {
    const head = (view && view.roster) || {};
    const versionId = str(head.versionId);
    return {
        name: str(head.name),
        versionLabel: str(head.versionLabel),
        stand: now,
        slots: { ...(head.slots || {}) },
        members: ((view && view.members) || []).map((row) => personOf(row, versionId)),
    };
}

/**
 * The picture's model and language for one roster, or null when the roster does not exist
 * or belongs to another server (the same answer as GET /api/rosters/roster).
 * @param {{ guildId: string, id: string, config: object, now?: number }} opts the caller is not
 *   passed on - the view is the readers' one for everybody
 * @returns {Promise<{ model: object, lang: string, roster: object }|null>}
 */
async function rosterImageModel({ guildId = "", id = "", config = {}, now = Date.now() } = {}) {
    const view = await buildRosterDetail({ guildId, id, user: null, config });
    if (!view) return null;
    const head = view.roster;
    const lang = categoryLang(head.categoryId, config, guildId);
    return { model: modelFromDetail(view, { now }), lang, roster: head };
}

/**
 * What a picture shows, as a hash: the model without its date, the switches and the language.
 * The date alone never counts, so a roster nobody touches is not edited each midnight.
 */
function pictureHash(model, { reserve = false, chars = false, lang = "" } = {}) {
    const shown = JSON.stringify({ model: { ...model, stand: null }, reserve: !!reserve, chars: !!chars, lang });
    return crypto.createHash("sha256").update(shown).digest("hex");
}

/** A built model drawn: the expensive step, so the job takes it only on a change. */
function drawPicture(built, { showReserve = false, showMoreChars = false } = {}) {
    const { svg } = rosterImageSvg(built.model, { showReserve, showMoreChars, lang: built.lang });
    return { svg, png: renderPng(svg) };
}

/** The short line above the posted picture. */
function pictureLine(lang, name, now = Date.now()) {
    return tr(lang, "Roster {name} as of {date}", { name, date: longDate(now, lang) });
}

/**
 * The drawn roster: SVG and PNG with the language they speak and the hash of what they show,
 * or null (see rosterImageModel). Not cached - drawn from the roster as it is now.
 * @param {{ guildId: string, id: string, config: object, showReserve?: boolean, showMoreChars?: boolean, now?: number }} opts
 * @returns {Promise<{ svg: string, png: Buffer, hash: string, lang: string, roster: object }|null>}
 */
async function rosterPicture({ showReserve = false, showMoreChars = false, ...opts } = {}) {
    const built = await rosterImageModel(opts);
    if (!built) return null;
    const { lang, roster } = built;
    return {
        ...drawPicture(built, { showReserve, showMoreChars }),
        hash: pictureHash(built.model, { reserve: showReserve, chars: showMoreChars, lang }),
        lang,
        roster,
    };
}

module.exports = { rosterPicture, rosterImageModel, modelFromDetail, pictureHash, drawPicture, pictureLine };
