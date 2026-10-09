// Class, spec and role of a roster member (docs/roster-profile.md "Spec eines
// Mitglieds"): what the Komposition tab, the members table's Rolle column and
// the overview cards' role counts all read, so the three always agree.
//
// It is the member's FIRST character of the roster that counts. Its class and
// spec come from a chain, the newest and most reliable source first:
//
//   1. "override" - the orga's choice for this roster (member.spec, set in the
//      member drawer as "Spec in diesem Roster"); ignored when it belongs to
//      another class than the character is known as.
//   2. "signup"   - the spec the person last signed up with in a raid of THIS
//      roster's category: own events (a signup names its characters, the one of
//      that name counts; upcoming ones first, then the past nights of the
//      attendance context, newest first), Raid-Helper's stored signups (spec
//      name only - it counts when it fits the character's class), then the spec
//      history imported from Raid-Helper (specHistoryStore, per version).
//   3. "logs"     - what the evaluated logs know about the character
//      (characterStore: class and spec from the loot export / WCL reports).
//   4. "profile"  - the raider profile's specs of the character; with several,
//      the one whose role matches what the logs saw the character play
//      (attendance context `roleByKey`), else the first.
//   5. "class"    - only the class is known (profile, character cache or a
//      signup without a fitting spec): it counts among the classes, not in the
//      roles or buffs, and the member is listed as "Spec unbekannt".
//
// The role is the resolved spec's role; without a spec, what the newest log saw
// the character play (tank / healer / dps), else none. Nothing is stored here:
// resolveMemberSpec reads, the orga's override is rosterStore's member.spec.
//
// Layering: a service - it reads stores, config and other services, never
// src/web. The loot council's classAndSpec (web/loot/lootCouncil.js) reads the
// same characterStore records the "logs" step does.
const raiderProfileStore = require("../../stores/raiderProfileStore");
const characterStore = require("../../stores/characterStore");
const { lastImportedSpecOf } = require("../../stores/specHistoryStore");
const { spec: specOfVersion, rulesFor } = require("../../config/gameVersions");
const { specKeyFromRaidHelper, ownUpcomingRaw } = require("../events/eventSources");
const { characterKeyOf, nameKeyOf } = require("../../utils/loot/lootImport");

const SOURCES = ["override", "signup", "logs", "profile", "class"];
const ATTENDING = new Set(["signed", "late", "bench", "tentative"]);

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** fn(), or `fallback` when it throws: every lookup here is best-effort. */
function attempt(fn, fallback) {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

/** "tank" | "healer" | "dps" | "" from a rule-set role (melee / ranged are damage). */
function roleOfSpecRole(role) {
    if (role === "tank" || role === "healer") return role;
    return role ? "dps" : "";
}

/** The rule-set spec record of a key in a version (with `classId`), or null. */
function specRecord(key, versionId) {
    const found = key ? specOfVersion(str(key), versionId) : null;
    if (!found) return null;
    const info = raiderProfileStore.specInfo(found.key);
    return info ? { ...found, classId: info.classId } : null;
}

/** A spec key that belongs to `className` (when that is known) in the version, else "". */
function fittingSpec(key, className, versionId) {
    const rec = specRecord(key, versionId);
    if (!rec) return "";
    return !className || rec.classId === className ? rec.key : "";
}

/** A spec name of the logs ("Balance", "Beast Mastery") as a rule-set key of the class, else "". */
function specFromLogName(className, specName, versionId) {
    const name = str(specName).replace(/\s+/g, "");
    if (!className || !name) return "";
    return fittingSpec(`${className}-${name}`, className, versionId);
}

/** The signup entries one stored signup offers: `[{ name, spec }]` (name "" = Raid-Helper, spec name only). */
function signupEntries(s) {
    if (!s || !s.userId || !ATTENDING.has(str(s.status) || "signed")) return [];
    if (Array.isArray(s.characters) && s.characters.length) {
        return s.characters.map((c) => ({ name: str(c && c.character), spec: str(c && c.spec) })).filter((e) => e.spec);
    }
    if (s.spec) return [{ name: str(s.character), spec: str(s.spec) }];
    const key = attempt(() => specKeyFromRaidHelper(s.className, s.specName), "");
    return key ? [{ name: "", spec: key }] : [];
}

/**
 * Every signup of the roster's category per person, newest first: upcoming own
 * events (latest start first), then the past nights of the attendance context.
 * @returns {Map<string, { name: string, spec: string }[]>}
 */
function signupIndex(roster, ctx) {
    const index = new Map();
    if (!roster || !roster.categoryId) return index;
    const upcoming = attempt(() => ownUpcomingRaw(roster.guildId, { categoryId: roster.categoryId }), [])
        .slice()
        .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    const past = ((ctx && (ctx.allRaidsByCategory || ctx.raidsByCategory)) || new Map()).get(roster.categoryId) || [];
    for (const ev of [...upcoming, ...past]) {
        // the last reaction of a person in one event is their answer
        for (const s of [...(ev.signUps || [])].reverse()) {
            const entries = signupEntries(s);
            if (!entries.length) continue;
            const uid = String(s.userId);
            if (!index.has(uid)) index.set(uid, []);
            index.get(uid).push(...entries);
        }
    }
    return index;
}

/**
 * What a resolution needs once per roster: the signups of its category, the
 * character cache and the log roles. `ctx` = the attendance context of the
 * roster's version (rosterAttendance.buildAttendanceContext), optional.
 */
function specContext(roster, ctx = null) {
    return {
        versionId: roster.versionId,
        signups: signupIndex(roster, ctx),
        charMap: attempt(() => characterStore.characterMap(), {}),
        roleByKey: (ctx && ctx.roleByKey) || {},
    };
}

/** The spec of the newest signup that fits the character (by name, else by class), or "". */
function specFromSignups(userId, nameKey, className, sctx) {
    for (const e of sctx.signups.get(String(userId)) || []) {
        if (e.name && characterKeyOf(e.name) !== nameKey) continue;
        const key = fittingSpec(e.spec, className, sctx.versionId);
        if (key) return key;
    }
    const imported = attempt(() => lastImportedSpecOf(userId, { versionId: sctx.versionId }), null);
    if (imported && (!imported.character || characterKeyOf(imported.character) === nameKey)) {
        return fittingSpec(imported.spec, className, sctx.versionId);
    }
    return "";
}

/** The profile spec of the character: the one of the role the logs saw, else the first. */
function specFromProfile(own, logRole, versionId) {
    const keys = ((own && own.specs) || []).map((s) => fittingSpec(s.key, own.className, versionId)).filter(Boolean);
    if (!keys.length) return "";
    const byRole = logRole ? keys.find((k) => roleOfSpecRole(specRecord(k, versionId).role) === logRole) : "";
    return byRole || keys[0];
}

/** The chain without the orga's override: `{ className, spec, source }`. */
function autoSpec(userId, key, sctx) {
    const nameKey = nameKeyOf(key);
    const profile = attempt(() => raiderProfileStore.getProfile(userId), null);
    const own = profile ? (raiderProfileStore.findCharacter(profile, key, sctx.versionId) || raiderProfileStore.findCharacter(profile, key)) : null;
    const cached = sctx.charMap[characterKeyOf(nameKey)] || null;
    const cachedClass = cached ? raiderProfileStore.normalizeClass(cached.className) : "";
    const knownClass = (own && own.className) || cachedClass;
    const logRole = sctx.roleByKey[characterKeyOf(nameKey)] || "";

    const fromSignup = specFromSignups(userId, nameKey, knownClass, sctx);
    if (fromSignup) return { className: specRecord(fromSignup, sctx.versionId).classId, spec: fromSignup, source: "signup" };
    const fromLogs = specFromLogName(knownClass, cached && cached.spec, sctx.versionId);
    if (fromLogs) return { className: knownClass, spec: fromLogs, source: "logs" };
    const fromProfile = specFromProfile(own, logRole, sctx.versionId);
    if (fromProfile) return { className: own.className, spec: fromProfile, source: "profile" };
    return { className: knownClass, spec: "", source: knownClass ? "class" : "" };
}

/**
 * Class, spec and role of one member's first character.
 * @param {string} userId
 * @param {{ chars: string[], spec?: string, charNames?: object }} member
 * @param {object} sctx  specContext(roster, ctx)
 * @returns {{ character: string, className: string, spec: string, specRole: string,
 *   role: "tank"|"healer"|"dps"|"", source: "override"|"signup"|"logs"|"profile"|"class"|"",
 *   auto: { className: string, spec: string, source: string }, override: string,
 *   reason: ""|"no_char"|"no_class"|"no_spec" }}
 *   `specRole` the rule set's (tank / healer / melee / ranged); `reason` why
 *   the spec is missing; `override` the orga's stored spec (also when ignored).
 */
function resolveMemberSpec(userId, member, sctx) {
    const key = (member && member.chars && member.chars[0]) || "";
    const override = str(member && member.spec);
    if (!key) {
        return { character: "", className: "", spec: "", specRole: "", role: "", source: "", auto: { className: "", spec: "", source: "" }, override, reason: "no_char" };
    }
    const auto = autoSpec(userId, key, sctx);
    const chosen = override ? fittingSpec(override, auto.className, sctx.versionId) : "";
    const pick = chosen
        ? { className: specRecord(chosen, sctx.versionId).classId, spec: chosen, source: "override" }
        : auto;
    const rec = pick.spec ? specRecord(pick.spec, sctx.versionId) : null;
    const logRole = sctx.roleByKey[characterKeyOf(nameKeyOf(key))] || "";
    let reason = "";
    if (!pick.className) reason = "no_class";
    else if (!pick.spec) reason = "no_spec";
    return {
        character: key,
        className: pick.className,
        spec: pick.spec,
        specRole: rec ? rec.role : "",
        role: rec ? roleOfSpecRole(rec.role) : (pick.className ? logRole : ""),
        source: pick.source,
        auto,
        override,
        reason,
    };
}

/** The specs of a class in a version, for the drawer's picker: `[{ key, id, label, labelEn, icon, role }]`. */
function specChoices(className, versionId) {
    const rules = rulesFor(versionId);
    const cls = rules ? rules.classes.find((c) => c.id === className) : null;
    if (!cls) return [];
    return cls.specs.map((s) => ({ key: s.key, id: s.id, label: s.label, labelEn: s.labelEn || s.label, icon: s.icon || "", role: s.role }));
}

/**
 * The class a member's first character is known as without the orga's choice
 * (profile, character cache, signup) - what rosterMembers checks a new
 * override against. "" when unknown.
 */
function knownClassOf(roster, userId, key, ctx = null) {
    if (!key) return "";
    return autoSpec(userId, key, specContext(roster, ctx)).className;
}

module.exports = { resolveMemberSpec, specContext, specChoices, knownClassOf, specRecord, roleOfSpecRole, SOURCES };
