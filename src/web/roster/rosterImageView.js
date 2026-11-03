// What the roster picture is drawn from ("Roster als Bild", docs/roster-profile.md): the
// roster page's own detail view (rosterView.buildRosterDetail) turned into the model of the
// pure builder services/roster/rosterImage.js. Reading the detail keeps the picture and the
// page in step - the same first character with the same resolved spec and role. The picture is
// always drawn in the readers' view (the slim rows of rosterView.slimMember, no trial dates),
// whoever makes it: the orga downloads and posts it for the raiders.
//
// Only the first char of a person is a row; the further chars ride along as icons. A person
// without a char shows the linked Kader's planned class and spec under their Discord name. A spec the
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

// The name of the picture in Discord. It also tells an attached old post from any other bot message.
const PICTURE_FILE = "roster.png";

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
 * @param {{ guildId: string, id: string, config: object, now?: number, background?: boolean }} opts the
 *   caller is not passed on - the view is the readers' one for everybody; `background` for a job
 *   (discord.fetchGuildMembersCached), never for a request
 * @returns {Promise<{ model: object, lang: string, roster: object }|null>}
 */
async function rosterImageModel({ guildId = "", id = "", config = {}, now = Date.now(), background = false } = {}) {
    const view = await buildRosterDetail({ guildId, id, user: null, config, background });
    if (!view) return null;
    const head = view.roster;
    const lang = categoryLang(head.categoryId, config, guildId);
    return { model: modelFromDetail(view, { now }), lang, roster: head };
}

// The date every hash draws with. Not 0: the builder takes a falsy date for today.
const HASH_STAND = 1;

/**
 * What a picture shows, as a hash: the SVG drawn with a fixed date, so a change the picture does
 * not show (pause to bench with the reserve hidden) changes nothing, and a roster nobody touches
 * is not edited each midnight. The orga's text belongs to it; without one the hash stays what it
 * has always been, so a picture from before the text is not edited for nothing.
 */
function pictureHash(model, { reserve = false, chars = false, lang = "de", text = "" } = {}) {
    const { svg } = rosterImageSvg({ ...model, stand: HASH_STAND }, { showReserve: !!reserve, showMoreChars: !!chars, lang });
    const hash = crypto.createHash("sha256").update(svg);
    if (str(text)) hash.update(`\n${str(text)}`);
    return hash.digest("hex");
}

/** A built model drawn: the PNG is the expensive step, so the job takes it only on a change. */
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
 * @param {{ guildId: string, id: string, config: object, showReserve?: boolean, showMoreChars?: boolean, text?: string, now?: number }} opts
 *   `text` is not drawn, it only counts for the hash (the line above the picture)
 * @returns {Promise<{ svg: string, png: Buffer, hash: string, lang: string, roster: object }|null>}
 */
async function rosterPicture({ showReserve = false, showMoreChars = false, text = "", ...opts } = {}) {
    const built = await rosterImageModel(opts);
    if (!built) return null;
    const { lang, roster } = built;
    return {
        ...drawPicture(built, { showReserve, showMoreChars }),
        hash: pictureHash(built.model, { reserve: showReserve, chars: showMoreChars, lang, text }),
        lang,
        roster,
    };
}

module.exports = { PICTURE_FILE, rosterPicture, rosterImageModel, modelFromDetail, pictureHash, drawPicture, pictureLine };
