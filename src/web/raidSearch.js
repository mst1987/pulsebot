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
    const names = (keys) => keys.map((k) => specs.get(k)).filter(Boolean).map(specNameEn).join(", ");
    // a buff a whole class brings (a totem, a blessing) is "Shaman (any spec)", not every spec of it
    const providers = (keys) => {
        const byClass = new Map();
        for (const k of keys) {
            const s = specs.get(k);
            if (s) byClass.set(s.classId, [...(byClass.get(s.classId) || []), s]);
        }
        return [...byClass.entries()].map(([classId, list]) => {
            const all = [...specs.values()].filter((s) => s.classId === classId).length;
            return list.length === all ? `${list[0].classLabelEn} (any spec)` : list.map(specNameEn).join(", ");
        }).join(", ");
    };
    const need = [];
    for (const r of gap.roles) need.push(`• ${r.missing}× ${ROLE_NAME[r.role][r.missing > 1 ? 1 : 0]}: ${names(r.specs)}`);
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
 *   specInfo: Object<string, { label, classLabel, classId, icon, color }>,
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
    // what the page needs to draw a spec: its icon, name and class colour
    const used = new Set([...roles, ...buffs].flatMap((x) => x.specs));
    const specInfo = Object.fromEntries([...used].map((k) => {
        const s = specs.get(k);
        return [k, { label: s.label, classLabel: s.classLabel, classId: s.classId, icon: s.icon || "", color: s.classColor }];
    }));
    return { ...gap, specInfo, text: gap.open || roles.length || buffs.length ? buildText(event, gap, specs) : "" };
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

module.exports = { suggestSearch, postSearch, specNameEn, MAX_TEXT };
