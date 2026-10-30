// What the "Anmeldungen" page (#256) and the raid detail's roster tab get to see
// of events and signups. Built from data the callers already loaded (the event
// groups of eventSources/raidEventGroups, the profiles, resolved Discord names)
// plus local store reads, so the rules — who sees which raid, what a row carries — can be tested
// without Discord or Raid-Helper.
//
// Who sees which raid (memberEventList): the raids the member may sign up for
// (signupAccess.canSignUp — the very rule the save checks) plus the ones they
// are already signed up for. For everybody, the orga included: "Für dich" and
// "Anmeldungen" are personal; the orga sees every raid on the raid pages, and
// the "Anmeldungen" page offers it "Alle Kategorien" (`all`).
const profiles = require("../../stores/raiderProfileStore");
const { isRaidSibling } = require("../../utils/raidGroup");
const { getEvent } = require("../../stores/eventStore");
const { profileRoles, roleCounts, signupWindow, allowedStatuses, wishPartnersSignedUp } = require("../../services/signups/signupService");
// "darf sich anmelden": the same rule guards saving a signup (checkRaiderRole)
const { signupAccess, inEventCategories } = require("../../services/signups/signupAccess");
const { upcomingRows } = require("../../services/events/overview/raidListing");
const { instanceById, VERSIONS, LEGACY_VERSION } = require("../../config/gameVersions");
const { versionOfEvent } = require("../../services/versions/mainVersion");
const { signupStatus } = require("../../utils/attendance");
const { accountCount } = require("../../utils/signup/capacity");
const { approvedPlacementFor } = require("../../services/setup/setupEditor");
const { approvedSetupOf } = require("../../services/setup/setupCore");
const { migrateSignup, maxCharactersFor } = require("../../services/signups/signupCharacters");
const { noteMode } = require("../../services/signups/signupNotes");

// A class has one colour in every version; all of them, so a class only one
// version plays still gets its colour (#541).
const CLASS_COLORS = new Map(VERSIONS.flatMap((v) => v.classes.map((c) => [c.id, c.color])));

const linkCheck = require("../../services/discord/linkCheck");

/**
 * A profile's characters as the signup dialog picks from them. With `versionId`
 * only the characters of that version (#741: the page lists the raids of one
 * version, a TBC character is nothing to pick for a Forever raid - the save
 * refuses it anyway, signupService `character_version`).
 */
function profileForSignup(profile, { versionId = "" } = {}) {
    const p = profile || { characters: [] };
    const roles = profileRoles(p);
    const chars = versionId ? p.characters.filter((c) => (c.versionId || LEGACY_VERSION) === versionId) : p.characters;
    return {
        characters: chars.map((c) => ({
            key: c.key,
            name: c.name,
            // The dialog offers only the characters of the event's game version (#543).
            versionId: c.versionId || LEGACY_VERSION,
            className: c.className,
            ...profileRoles(p, c.key),
            specs: c.specs.map((s) => {
                const info = profiles.specInfo(s.key) || {};
                return { key: s.key, label: info.label || s.key, icon: info.icon || "", role: info.role || "", gear: s.gear };
            }),
        })),
        canOfftank: roles.canOfftank,
        canHeal: roles.canHeal,
    };
}

/** One named character of a signup with class colour, spec label and icon (#293). */
function characterSummary(c) {
    const info = profiles.specInfo(c.spec) || {};
    const classId = info.classId || String(c.spec || "").split("-")[0] || "";
    return {
        character: c.character || "",
        className: classId,
        classColor: CLASS_COLORS.get(classId) || "",
        spec: c.spec || "",
        specLabel: info.label || "",
        specIcon: info.icon || "",
        role: c.role || info.role || "",
        // the character's own status (Discord's "Spät" moves only the first); none for an absence
        ...(c.status ? { status: c.status } : {}),
    };
}

/** An own signup as the page shows it (spec label and icon resolved). */
function signupSummary(raw) {
    if (!raw) return null;
    const s = migrateSignup(raw);
    const info = profiles.specInfo(s.spec) || {};
    return {
        // every named character in priority order; the fields below mirror the first
        characters: (s.characters || []).map(characterSummary),
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
 * The raider's rows: every upcoming event of both sources the member may sign
 * up for or already signed up for, soonest first, with their own status. An
 * own event carries what the dialog needs (window, role counts, allowed
 * statuses, wish partners); a Raid-Helper event only its link into Discord.
 * Every row says whether its category is open to everyone (`openToAll`, the
 * "PuG" badge).
 *
 * `roleIds`: the member's roles (viewerRoles.js); null = not readable - then
 * only the raids that need no role show, and `rolesUnknown` says some may be
 * missing. `viewAs`: "Ansicht als Rolle" - the roles decide alone (the
 * admin's own signups make nothing visible, a roster counts its role holders).
 * `all`: every raid, the orga's "Alle Kategorien". `byOrga`: the save exempts
 * the caller (`raids` write), so no row of theirs is marked as locked.
 * @returns {{ rows: object[], rolesUnknown: boolean }}
 */
function memberEventList(groups, { userId, guildId = "", config = {}, roleIds = null, all = false, byOrga = false, viewAs = false, profile = null, now = Date.now() } = {}) {
    const uid = String(userId || "");
    const byId = new Map((groups || []).flatMap((g) => (g.events || []).map((e) => [e.id, e])));
    let rolesUnknown = false;
    const rows = upcomingRows(groups)
        .map((row) => ({ row, ev: byId.get(row.id) || {} }))
        // a further raid of a raid group (#811) has no signup of its own — the raiders sign up at the first raid
        .filter(({ ev }) => !isRaidSibling(ev))
        .filter(({ row }) => (row.startTime || 0) * 1000 > now - 6 * 3600 * 1000)
        .map(({ row, ev }) => {
            const source = row.source || "raidhelper";
            // the raid's version decides the roster and the roles (#739)
            const stored = source === "eventhelper" ? (getEvent(row.id) || {}) : {};
            const versionId = versionOfEvent({ ...stored, ...ev, categoryId: stored.categoryId || row.categoryId }, { config });
            const access = signupAccess(stored.categoryId || row.categoryId, { userId: uid, roleIds, config, versionId, rosterByRoles: viewAs });
            return { row, ev, access };
        })
        .filter(({ row, ev, access }) => {
            if (all) return true;
            const mine = !viewAs && (ev.signUps || []).some((s) => String(s.userId) === uid);
            if (mine) return true;
            if (!inEventCategories(row.categoryId, config)) return false;
            if (access.allowed === null) rolesUnknown = true;
            return access.allowed === true;
        })
        .sort((a, b) => (a.row.startTime || 0) - (b.row.startTime || 0))
        .map(({ row, ev, access }) => {
            const source = row.source || "raidhelper";
            const signUps = ev.signUps || [];
            const attending = signUps.filter((s) => ["signed", "late"].includes(signupStatus(s))).length;
            // what the row shows (#520): the single Discord accounts, no "/size"
            const accounts = accountCount(signUps, signupStatus);
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
                accounts,
                discordUrl: linkCheck.channelLink(guildId, row.channelId),
                // no raider role, no roster-only signup: open to everyone, a PuG raid
                openToAll: access.rule === "open",
            };
            if (source !== "eventhelper") {
                return {
                    ...base,
                    discordUrl: linkCheck.messageLink(guildId, row.channelId, row.id),
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
                discordUrl: (msg && msg.messageId && linkCheck.messageLink(guildId, msg.channelId || row.channelId, msg.messageId)) || base.discordUrl,
                // Always a version (#543): the dialog filters the characters by it.
                versionId: versionOfEvent(event, { config }),
                deadline: win.deadline,
                deadlinePassed: win.deadlinePassed,
                started: win.started,
                // Event verwalten (#288): the orga closed the signup or cancelled the raid.
                signupsClosed: !!stored.signupsClosed,
                cancelled: stored.status === "cancelled",
                cancelReason: (stored.cancel && stored.cancel.reason) || "",
                allowedStatuses: allowedStatuses(event, { now }),
                counts: roleCounts(event, signUps),
                wishes: !!stored.wishes,
                // Whether "Vielleicht" / "Absagen" ask for a message: required | optional | none.
                noteMode: noteMode(stored.categoryId || row.categoryId, config),
                // How many own characters one signup may name here (the category's setting, default 8):
                // the dialog offers "+ Kann auch mit …" up to it; the bulk dialog takes the lowest of its raids.
                maxCharacters: maxCharactersFor(stored.categoryId || row.categoryId, config),
                wishPartners: wishPartnersSignedUp(profile, signUps.filter((s) => String(s.userId) !== uid)),
                mine: signupSummary(own),
                // Where the *approved* setup puts the member (#263) — a draft is never shown.
                placement: approvedPlacementFor(stored, uid),
                // whether an approved setup exists at all: with it, no placement means "not placed", not "no setup yet"
                setupApproved: !!approvedSetupOf(stored),
                // "Anmeldung nur für das Roster" (#658): true when this member may not sign up (no roster member
                // with status core / trial / bench, no own signup, not exempt) - the dialog says so up front
                // (the roster of the raid's version, #739). Only "Alle Kategorien" lists such a raid at all.
                rosterOnly: !byOrga && !own && access.code === "roster_only",
                // the same for a category whose raider role the member lacks
                roleMissing: !byOrga && !own && access.code === "raider_role",
            };
        });
    return { rows, rolesUnknown };
}

/** memberEventList's rows alone. */
function memberEventRows(groups, opts = {}) {
    return memberEventList(groups, opts).rows;
}

/**
 * All signups of an own event for the orga (the raid detail's `ownSignups`):
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

module.exports = { profileForSignup, signupSummary, memberEventList, memberEventRows, eventSignupList };
