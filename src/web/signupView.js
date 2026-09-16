// What the "Anmeldungen" page (#256) and the raid detail's roster tab get to see
// of events and signups. Built from data the callers already loaded (the event
// groups of eventSources/raidEventGroups, the profiles, resolved Discord names)
// plus local store reads, so the rules — who sees which category, what a row carries — can be tested
// without Discord or Raid-Helper.
const profiles = require("./raiderProfileStore");
const { getEvent } = require("./eventStore");
const { profileRoles, roleCounts, signupWindow, allowedStatuses, wishPartnersSignedUp } = require("./signupService");
const { upcomingRows } = require("./raidListing");
const { instanceById, rulesFor, DEFAULT_VERSION } = require("../config/gameVersions");
const { signupStatus } = require("../utils/attendance");

const CLASS_COLORS = new Map(rulesFor(DEFAULT_VERSION).classes.map((c) => [c.id, c.color]));

const discordChannelUrl = (guildId, channelId) => (guildId && channelId ? `https://discord.com/channels/${guildId}/${channelId}` : "");

/**
 * Whether a member sees a category's events on the page. Only the event
 * categories count (`config.categoryIds`, when any are set); a category with
 * raider roles (`config.categoryRoles`) is for the holders of one of them. When
 * the member's roles cannot be read (`roleIds === null`) the category shows —
 * an event post in Discord is no secret, a missing raid is a real loss. The
 * orga sees everything.
 */
function categoryVisible(categoryId, { config = {}, roleIds = null, orga = false } = {}) {
    if (orga) return true;
    const cats = Array.isArray(config.categoryIds) ? config.categoryIds.map(String) : [];
    if (cats.length && !cats.includes(String(categoryId || ""))) return false;
    const roles = ((config.categoryRoles || {})[String(categoryId || "")] || []).map(String);
    if (!roles.length || roleIds === null) return true;
    return roles.some((r) => roleIds.includes(r));
}

/** A profile's characters as the signup dialog picks from them. */
function profileForSignup(profile) {
    const p = profile || { characters: [] };
    const roles = profileRoles(p);
    return {
        characters: p.characters.map((c) => ({
            key: c.key,
            name: c.name,
            className: c.className,
            main: c.main,
            specs: c.specs.map((s) => {
                const info = profiles.specInfo(s.key) || {};
                return { key: s.key, label: info.label || s.key, icon: info.icon || "", role: info.role || "", gear: s.gear };
            }),
        })),
        canOfftank: roles.canOfftank,
        canHeal: roles.canHeal,
    };
}

/** An own signup as the page shows it (spec label and icon resolved). */
function signupSummary(s) {
    if (!s) return null;
    const info = profiles.specInfo(s.spec) || {};
    return {
        status: s.status || "signed",
        character: s.character || "",
        className: info.classId || String(s.spec || "").split("-")[0] || "",
        classColor: CLASS_COLORS.get(info.classId || String(s.spec || "").split("-")[0]) || "",
        spec: s.spec || "",
        specLabel: info.label || "",
        specIcon: info.icon || "",
        role: s.role || "",
        canAlso: s.canAlso || [],
        comment: s.comment || "",
    };
}

/**
 * The page's rows: every upcoming event of both sources the member may see,
 * soonest first, with their own status. An own event carries what the dialog
 * needs (window, role counts, allowed statuses, wish partners); a Raid-Helper
 * event only its link into Discord.
 */
function memberEventRows(groups, { userId, guildId = "", config = {}, roleIds = null, orga = false, profile = null, now = Date.now() } = {}) {
    const uid = String(userId || "");
    const byId = new Map((groups || []).flatMap((g) => (g.events || []).map((e) => [e.id, e])));
    return upcomingRows(groups)
        .map((row) => ({ row, ev: byId.get(row.id) || {} }))
        .filter(({ row, ev }) => {
            const signUps = ev.signUps || [];
            const mine = signUps.some((s) => String(s.userId) === uid);
            return mine || categoryVisible(row.categoryId, { config, roleIds, orga });
        })
        .filter(({ row }) => (row.startTime || 0) * 1000 > now - 6 * 3600 * 1000)
        .sort((a, b) => (a.row.startTime || 0) - (b.row.startTime || 0))
        .map(({ row, ev }) => {
            const source = row.source || "raidhelper";
            const signUps = ev.signUps || [];
            const attending = signUps.filter((s) => ["signed", "late"].includes(signupStatus(s))).length;
            const own = signUps.find((s) => String(s.userId) === uid) || null;
            const firstInstance = (ev.instanceIds || []).map((id) => instanceById(id)).find(Boolean);
            const base = {
                id: row.id,
                source,
                title: row.title,
                startTime: row.startTime,
                categoryId: row.categoryId,
                categoryName: row.categoryName,
                contentIds: row.contentIds,
                contentSources: row.contentSources,
                instanceIcon: (firstInstance && firstInstance.icon) || "",
                size: row.raidSize,
                attending,
                discordUrl: discordChannelUrl(guildId, row.channelId),
            };
            if (source !== "eventhelper") {
                return {
                    ...base,
                    discordUrl: guildId && row.channelId ? `${base.discordUrl}/${row.id}` : "",
                    mine: own ? { status: signupStatus(own), specName: own.specName || "" } : null,
                };
            }
            // The group row carries the plan; where the message sits and the wishes switch only the store knows.
            const stored = getEvent(row.id) || {};
            const event = { ...stored, ...ev, source };
            const win = signupWindow(event, now);
            const msg = stored.message;
            return {
                ...base,
                discordUrl: msg && msg.messageId ? `${discordChannelUrl(guildId, msg.channelId || row.channelId)}/${msg.messageId}` : base.discordUrl,
                versionId: ev.versionId || "",
                deadline: win.deadline,
                deadlinePassed: win.deadlinePassed,
                started: win.started,
                allowedStatuses: allowedStatuses(event, { now }),
                counts: roleCounts(event, signUps),
                wishes: !!stored.wishes,
                wishPartners: wishPartnersSignedUp(profile, signUps.filter((s) => String(s.userId) !== uid)),
                mine: signupSummary(own),
            };
        });
}

/**
 * All signups of an own event for the orga (raid detail, `GET /api/signups/event`):
 * the stored signup plus the Discord name, class and spec label — comment and
 * "kann auch" included, sorted by role and then by when they signed up.
 */
function eventSignupList(signups, names = {}) {
    const ROLE_RANK = { tank: 0, healer: 1, melee: 2, ranged: 3, "": 4 };
    return (signups || [])
        .map((s) => ({
            userId: String(s.userId),
            name: names[String(s.userId)] || "",
            ...signupSummary(s),
            at: Number(s.at) || 0,
        }))
        .sort((a, b) => (ROLE_RANK[a.role] ?? 4) - (ROLE_RANK[b.role] ?? 4) || a.at - b.at);
}

module.exports = { categoryVisible, profileForSignup, signupSummary, memberEventRows, eventSignupList };
