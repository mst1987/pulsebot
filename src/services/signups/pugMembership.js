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
const { generalInviteUrl } = require("../discord/pugInvites");
const { accessRule } = require("./signupAccess");
const { versionOfEvent } = require("../versions/mainVersion");

const PUG_MEMBERS_ERROR = "Nur für Mitglieder des PuG-Servers.";

/** The server whose members may sign up for the raid. */
function serverOf(event, cfg) {
    return String((event && event.guildId) || (cfg && cfg.guildId) || "");
}

/**
 * The invite link a refused user gets for the raid's server: its general
 * invite (#905, made on a click in the settings) - "" while there is none.
 */
function pugInviteUrl(event, { config } = {}) {
    const guildId = serverOf(event, config || settingsStore.getConfig());
    if (!guildId) return "";
    return safeInviteUrl(generalInviteUrl(guildId));
}

/**
 * What the public event page (/e/<id>, #908) needs about who looks:
 * `isMember` on the raid's server (true / false / null while unknown or not
 * logged in) and the server's invite. Only an open PuG raid asks Discord;
 * every other raid gets `{ isMember: null, inviteUrl: "" }`.
 * @returns {Promise<{ isMember: boolean|null, inviteUrl: string }>}
 */
async function pugPageViewer(event, userId, { config } = {}) {
    const cfg = config || settingsStore.getConfig();
    if (!event || !isOpenRaid(event, cfg)) return { isMember: null, inviteUrl: "" };
    const uid = String(userId || "");
    const isMember = uid ? await discord.guildMembership(serverOf(event, cfg), uid) : null;
    return { isMember, inviteUrl: pugInviteUrl(event, { config: cfg }) };
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
    const list = Array.isArray(rows) ? rows : [];
    // the raid of each row that needs the check (null: the row stays as it is)
    const events = [];
    for (const row of list) {
        const candidate = row && row.source === "eventhelper" && row.openToAll && !row.started && !row.cancelled && !holdsSignup(row.mine);
        const event = candidate ? eventStore.getEvent(row.id) : null;
        events.push(event && (await isOrga(event)) !== true ? event : null);
    }
    const members = await membershipByServer(events.filter(Boolean), userId, { config: cfg });
    return list.map((row, i) => {
        const event = events[i];
        if (!event) return row;
        const member = members.get(serverOf(event, cfg));
        if (member === false) return { ...row, membersOnly: true, inviteUrl: pugInviteUrl(event, { config: cfg }) };
        if (member === null) return { ...row, membershipUnknown: true };
        return row;
    });
}

/** Whether the raid's category takes everyone - the only case the members check applies to. */
function isOpenRaid(event, cfg) {
    return accessRule(event.categoryId, { config: cfg, versionId: versionOfEvent(event, { config: cfg }) }).rule === "open";
}

/**
 * The user's membership on every server of the given raids: one lookup per
 * server, all servers at once - a hanging Discord then costs one time limit
 * (guildMembership), not one per server.
 * @returns {Promise<Map<string, boolean | null>>} server id -> true / false / null
 */
async function membershipByServer(events, userId, { config } = {}) {
    const cfg = config || settingsStore.getConfig();
    const uid = String(userId || "");
    const guilds = [...new Set((events || []).map((e) => serverOf(e, cfg)))];
    const answers = await Promise.all(guilds.map((g) => discord.guildMembership(g, uid)));
    return new Map(guilds.map((g, i) => [g, answers[i]]));
}

module.exports = {
    checkPugMember, markMembersOnly, membershipByServer, isOpenRaid, pugInviteUrl, pugPageViewer, safeInviteUrl, holdsSignup, serverOf,
    PUG_MEMBERS_ERROR,
};
