// "Suche": which classes and specs the raid still needs, worked out from the
// setup as it stands — and a message the orga can post into the event channel
// to look for them.
//
// What is missing comes from the setup's own checks (setupEditor / proposal):
//   * roles — a tank, healer, melee or ranged minimum that is not met yet;
//   * buffs — a required buff (raid template) or a raid buff nobody brings;
//   * open places — the raid size minus the raiders placed in groups.
// Each gap names the specs that would fill it: the specs of that role, or the
// specs that provide the buff (config/gameVersions/buffs.js). Only own events —
// their setup lives here (setupEditor.js).
//
// The text is for raiders, so it is English (like every raider-facing bot text)
// and uses the English class and spec names; it ends with the link to the signup
// message. The orga edits it before it goes out.
const eventStore = require("./eventStore");
const discord = require("./discord");
const { emojiFor, specEmojiName, classEmojiName, roleUiEmojiName } = require("./appEmojis");
const { rulesFor, DEFAULT_VERSION } = require("../config/gameVersions");

const ROLES = ["tank", "healer", "melee", "ranged"];
const ROLE_NAME = { tank: ["Tank", "Tanks"], healer: ["Healer", "Healers"], melee: ["Melee DPS", "Melee DPS"], ranged: ["Ranged DPS", "Ranged DPS"] };
const MAX_TEXT = 1900;

const fail = (status, code, message) => ({ error: { status, code, message } });

function rulesOf(event) {
    return rulesFor((event && event.versionId) || DEFAULT_VERSION) || rulesFor(DEFAULT_VERSION);
}

/** Every spec of a rule set by its key, with its class' English name. */
function specTable(rules) {
    const map = new Map();
    for (const c of rules.classes) {
        for (const s of c.specs) map.set(s.key, { ...s, classLabelEn: c.labelEn || c.id, classLabel: c.label || c.id, classColor: c.color || "" });
    }
    return map;
}

/** "Shaman (Enhancement)". */
const specNameEn = (spec) => `${spec.classLabelEn} (${spec.labelEn || spec.id})`;

/** The app emoji of a name plus a space, or "" while it is not uploaded (the text reads fine without it). */
const icon = (name) => {
    const e = name ? emojiFor(name) : "";
    return e ? `${e} ` : "";
};
/** A spec with its icon in front: "<emoji> Shaman (Enhancement)". */
const specWithIcon = (spec) => `${icon(specEmojiName(spec.key))}${specNameEn(spec)}`;

/** The specs whose own role is `role`. */
function specsOfRole(specs, role) {
    return [...specs.values()].filter((s) => s.role === role).map((s) => s.key);
}

/** The link to the signup message, else the event channel, else "". */
function eventLink(event) {
    const guildId = String((event && event.guildId) || "");
    const channelId = String((event && event.channelId) || "");
    if (!guildId || !channelId) return "";
    const messageId = event.message && event.message.messageId ? String(event.message.messageId) : "";
    return `https://discord.com/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ""}`;
}

function buildText(event, gap, specs) {
    const lines = [`**Looking for more raiders – ${event.title || "Raid"}**`];
    const when = Number(event.startTime) ? `<t:${Number(event.startTime)}:F> · ` : "";
    lines.push(`${when}${gap.placed} of ${gap.size} places filled`);
    const names = (keys) => keys.map((k) => specs.get(k)).filter(Boolean).map(specWithIcon).join(", ");
    // a buff a whole class brings (a totem, a blessing) is "Shaman (any spec)", not every spec of it
    const providers = (keys) => {
        const byClass = new Map();
        for (const k of keys) {
            const s = specs.get(k);
            if (s) byClass.set(s.classId, [...(byClass.get(s.classId) || []), s]);
        }
        return [...byClass.entries()].map(([classId, list]) => {
            const all = [...specs.values()].filter((s) => s.classId === classId).length;
            return list.length === all ? `${icon(classEmojiName(classId))}${list[0].classLabelEn} (any spec)` : list.map(specWithIcon).join(", ");
        }).join(", ");
    };
    const need = [];
    for (const r of gap.roles) need.push(`• ${icon(roleUiEmojiName(r.role))}${r.missing}× ${ROLE_NAME[r.role][r.missing > 1 ? 1 : 0]}: ${names(r.specs)}`);
    for (const b of gap.buffs.filter((x) => x.required)) need.push(`• Needed for a required buff: ${providers(b.specs)}`);
    const nice = gap.buffs.filter((x) => !x.required);
    if (nice.length) need.push(`• Would also help: ${providers([...new Set(nice.flatMap((b) => b.specs))])}`);
    if (need.length) lines.push("", "Still needed:", ...need);
    else if (gap.open > 0) lines.push("", `${gap.open} places open – every class and spec is welcome.`);
    const link = eventLink(event);
    if (link) lines.push("", `Sign up: ${link}`);
    return lines.join("\n").slice(0, MAX_TEXT);
}

/**
 * What the raid still needs, from the setup as it stands.
 * @param {object} event  an eventStore event (`setup`, `size`, `versionId`, …)
 * @returns {null | { size: number, placed: number, open: number,
 *   roles: { role: string, missing: number, specs: string[] }[],
 *   buffs: { key: string, label: string, icon: string, required: boolean, specs: string[] }[],
 *   specInfo: Object<string, { label, classLabel, classId, icon, color }>,   every spec of the rule set
 *   roleSpecs: Object<string, string[]>,   role -> the keys of its specs
 *   text: string }}  null without a setup
 */
function suggestSearch(event) {
    const setup = event && event.setup;
    if (!setup) return null;
    const rules = rulesOf(event);
    const specs = specTable(rules);
    const checks = setup.checks || {};
    const placed = (setup.groups || []).reduce((n, g) => n + (g.slots || []).length, 0);
    const size = Number(event.size) || Number(checks.size && checks.size.size) || 0;

    const roles = [];
    for (const role of ROLES) {
        const c = (checks.roles || {})[role];
        const missing = c ? Math.max(0, (Number(c.min) || 0) - (Number(c.count) || 0)) : 0;
        if (missing > 0) roles.push({ role, missing, specs: specsOfRole(specs, role) });
    }

    const providers = new Map([...rules.partyBuffs, ...rules.raidBuffs].map((b) => [b.key, b.providers || []]));
    const buffs = [];
    const add = (list, required) => {
        for (const b of list || []) {
            if (b.present || buffs.some((x) => x.key === b.key)) continue;
            const keys = (providers.get(b.key) || []).filter((k) => specs.has(k));
            if (keys.length) buffs.push({ key: b.key, label: b.label, icon: b.icon || "", required, specs: keys });
        }
    };
    add(checks.buffs && checks.buffs.required, true);
    add(checks.buffs && checks.buffs.raid, false);

    const gap = { size, placed, open: Math.max(0, size - placed), roles, buffs };
    // what the page needs to draw a spec (icon, name, class colour) — every spec, so the orga can add one to a role — and which specs a role has
    const specInfo = Object.fromEntries([...specs.values()].map((s) => [s.key, { label: s.label, classLabel: s.classLabel, classId: s.classId, icon: s.icon || "", color: s.classColor }]));
    const roleSpecs = Object.fromEntries(ROLES.map((role) => [role, specsOfRole(specs, role)]));
    return { ...gap, specInfo, roleSpecs, text: gap.open || roles.length || buffs.length ? buildText(event, gap, specs) : "" };
}

/**
 * The message for needs the orga edited (more or fewer of a role, some specs
 * left out, a buff dropped, a role added) — same words as the suggestion.
 * Everything comes from the page, so it is cleaned first: a known role, a count
 * of 1–40, only specs the rule set has (none left = every spec of the role),
 * only buffs the rule set knows.
 * @param {object} event  an eventStore event with a setup
 * @param {{ roles?: { role, missing, specs? }[], buffs?: { key, required?, specs? }[] }} needs
 * @returns {{ text: string } | { error: object }}
 */
function textForNeeds(event, needs) {
    if (!event || !event.setup) return fail(400, "no_setup", "Es gibt noch kein Setup.");
    const rules = rulesOf(event);
    const specs = specTable(rules);
    const roles = [];
    for (const r of Array.isArray(needs && needs.roles) ? needs.roles : []) {
        const role = String((r && r.role) || "");
        const missing = Math.floor(Number(r && r.missing));
        if (!ROLES.includes(role) || !(missing >= 1) || roles.some((x) => x.role === role)) continue;
        const chosen = (Array.isArray(r.specs) ? r.specs : []).map(String).filter((k) => specs.has(k) && specs.get(k).role === role);
        roles.push({ role, missing: Math.min(missing, 40), specs: chosen.length ? chosen : specsOfRole(specs, role) });
    }
    const providers = new Map([...rules.partyBuffs, ...rules.raidBuffs].map((b) => [b.key, b.providers || []]));
    const buffs = [];
    for (const b of Array.isArray(needs && needs.buffs) ? needs.buffs : []) {
        const key = String((b && b.key) || "");
        if (!providers.has(key) || buffs.some((x) => x.key === key)) continue;
        const known = providers.get(key).filter((k) => specs.has(k));
        const chosen = (Array.isArray(b.specs) ? b.specs : []).map(String).filter((k) => known.includes(k));
        buffs.push({ key, required: b.required === true, specs: chosen.length ? chosen : known });
    }
    const placed = (event.setup.groups || []).reduce((n, g) => n + (g.slots || []).length, 0);
    const size = Number(event.size) || Number(event.setup.checks && event.setup.checks.size && event.setup.checks.size.size) || 0;
    return { text: buildText(event, { size, placed, open: Math.max(0, size - placed), roles, buffs }, specs) };
}

/**
 * Post the search into the event channel and log it on the event.
 * @param {{ guildId?: string, eventId: string, userId?: string, byName?: string, text?: string }} p
 *   `text` = what the orga edited; without it the suggestion goes out as it is
 * @returns {Promise<{ message: string, url?: string } | { error: object }>}
 */
async function postSearch({ guildId, eventId, userId = "", byName = "", text = "" }) {
    if (!eventStore.isOwnEventId(eventId)) return fail(409, "raidhelper", "Das Setup dieses Events liegt bei Raid-Helper.");
    const event = eventStore.getEvent(eventId);
    if (!event || (guildId && event.guildId && event.guildId !== String(guildId))) return fail(404, "not_found", "Event nicht gefunden.");
    if (event.status === "cancelled") return fail(400, "cancelled", "Das Event ist abgesagt – da wird niemand mehr gesucht.");
    if (!event.channelId) return fail(400, "no_channel", "Das Event hat keinen Kanal.");
    const message = String(text || "").trim() || (suggestSearch(event) || {}).text || "";
    if (!message) return fail(400, "nothing_needed", "Es fehlt nichts – es gibt nichts zu suchen.");
    if (message.length > 2000) return fail(400, "too_long", "Der Text ist länger als die 2000 Zeichen, die Discord erlaubt.");
    let posted;
    try {
        posted = await discord.postNotice(event.channelId, message);
    } catch (e) {
        return fail(502, "post_failed", `Konnte nicht posten: ${e.message}`);
    }
    eventStore.appendEventLog(event.id, { action: "search", by: String(userId || ""), byName, detail: message.split("\n")[0].slice(0, 120) });
    return { message: "Suche im Kanal gepostet.", url: posted && posted.url };
}

module.exports = { suggestSearch, textForNeeds, postSearch, specNameEn, MAX_TEXT };
