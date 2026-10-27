// PuG raids on the web only for members of the PuG server (#907).
//
// A PuG category (signupAccess rule "open") takes everyone - in Discord that is
// fine, whoever presses the button is on the server. The web page has no such
// gate: anybody with a login could sign up for a server they never joined. So
// the web routes (and only they - the bot and the partner channel stay as they
// are) ask the raid's server whether the user is a member:
//
//   * true / null (unreadable - a Discord hiccup never refuses a raider) pass;
//   * false refuses with `pug_members_only` and the server's invite link
//     (`inviteUrl`, "" while none is known), so the page can offer "beitreten".
//
// Exempt like the raider-role rule: the orga of the raid, a member who already
// has a signup for it, and every category that is not open (guild raids keep
// their own rule, signupAccess.js).
const settingsStore = require("../../stores/settingsStore");
const signupStore = require("../../stores/signupStore");
const eventStore = require("../../stores/eventStore");
const discord = require("../discord/discord");
const { accessRule } = require("./signupAccess");
const { versionOfEvent } = require("../events/mainVersion");

const PUG_MEMBERS_ERROR = "Nur für Mitglieder des PuG-Servers.";

/** The server whose members may sign up for the raid. */
function serverOf(event, cfg) {
    return String((event && event.guildId) || (cfg && cfg.guildId) || "");
}

/**
 * The invite link a refused user gets for the raid's server - "" while none is known.
 * Hook for #905: `require("../discord/pugInvites").generalInviteUrl(guildId)`
 * (synchronous, a URL or "") goes into the safeInviteUrl() call below.
 */
function pugInviteUrl(event, { config } = {}) {
    const guildId = serverOf(event, config || settingsStore.getConfig());
    if (!guildId) return "";
    return safeInviteUrl("");
}

/** Only an https link goes to the page as a link target ("" otherwise). */
function safeInviteUrl(url) {
    const s = String(url || "").trim();
    return /^https:\/\/\S+$/i.test(s) ? s : "";
}

/**
 * Whether an existing signup exempts the user from the members check: a real
 * signup does, a stored absence ("Abgemeldet") does not - otherwise anybody
 * could sign off once and then sign up as a non-member.
 */
function holdsSignup(prev) {
    return Boolean(prev) && prev.status !== "absence";
}

/**
 * Whether the user may sign up for the raid on the web (see the head).
 * `membership` (true / false / null) skips the Discord lookup - the bulk
 * route asks once per server.
 * @returns {Promise<{ ok: true } | { code: "pug_members_only", error: string, inviteUrl: string }>}
 */
async function checkPugMember(event, userId, { byOrga = false, previous, config, membership } = {}) {
    if (byOrga || !event) return { ok: true };
    const cfg = config || settingsStore.getConfig();
    const uid = String(userId || "");
    const { rule } = accessRule(event.categoryId, { config: cfg, versionId: versionOfEvent(event, { config: cfg }) });
    if (rule !== "open") return { ok: true };
    const prev = previous === undefined ? signupStore.getSignup(event.id, uid) : previous;
    if (holdsSignup(prev)) return { ok: true };
    const member = membership !== undefined ? membership : await discord.guildMembership(serverOf(event, cfg), uid);
    if (member !== false) return { ok: true };
    return { code: "pug_members_only", error: PUG_MEMBERS_ERROR, inviteUrl: pugInviteUrl(event, { config: cfg }) };
}

/**
 * The page's rows marked up front (GET /api/signups): an open PuG raid of
 * another server gets `membersOnly: true` and `inviteUrl`, so the dialog shows
 * the hint instead of a form that would be refused; `membershipUnknown: true`
 * when Discord could not tell (the form stays, the save decides). One lookup
 * per server. Exempt as in checkPugMember(): own signup (not an absence),
 * the orga of the raid (`isOrga(event)`), closed or other categories.
 * @param {object[]} rows signupView.memberEventList() rows
 * @param {string} userId
 * @param {{ config?: object, isOrga?: (event: object) => boolean | Promise<boolean> }} [opts]
 * @returns {Promise<object[]>}
 */
async function markMembersOnly(rows, userId, { config, isOrga = () => false } = {}) {
    const cfg = config || settingsStore.getConfig();
    const uid = String(userId || "");
    const cache = new Map();
    const out = [];
    for (const row of rows || []) {
        const candidate = row && row.source === "eventhelper" && row.openToAll && !row.started && !row.cancelled && !holdsSignup(row.mine);
        const event = candidate ? eventStore.getEvent(row.id) : null;
        if (!event || (await isOrga(event)) === true) {
            out.push(row);
            continue;
        }
        const guild = serverOf(event, cfg);
        if (!cache.has(guild)) cache.set(guild, await discord.guildMembership(guild, uid));
        const member = cache.get(guild);
        if (member === false) out.push({ ...row, membersOnly: true, inviteUrl: pugInviteUrl(event, { config: cfg }) });
        else if (member === null) out.push({ ...row, membershipUnknown: true });
        else out.push(row);
    }
    return out;
}

module.exports = { checkPugMember, markMembersOnly, pugInviteUrl, safeInviteUrl, holdsSignup, serverOf, PUG_MEMBERS_ERROR };
