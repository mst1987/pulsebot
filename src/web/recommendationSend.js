// Sending approved recommendations to the raiders as Discord DMs.
//
// Only what the raid lead approved goes out (recommendations.js /
// recommendationReview), one DM per raider with their own points and a link
// to their player page. Who a character belongs to comes from the raider →
// character assignment (raiderCharactersStore); a character nobody is
// assigned to, or that two accounts claim, is reported instead of guessed.
// Every send is remembered on the report (recommendationSent), so a second
// click sends nothing twice unless the approved set changed.
const { applyReview } = require("../utils/logcheck/recommendations");
const { publicBaseUrl } = require("../config/variables");

/**
 * Invert the assignment map: character name (lower case) → { userId } or
 * { ambiguous: [userIds] } when several accounts claim the same name.
 */
function characterOwners(assignments) {
    const owners = new Map();
    for (const map of Object.values(assignments || {})) {
        for (const [userId, name] of Object.entries(map || {})) {
            const key = String(name || "").trim().toLowerCase();
            if (!key) continue;
            if (!owners.has(key)) owners.set(key, new Set());
            owners.get(key).add(String(userId));
        }
    }
    const out = new Map();
    for (const [key, ids] of owners) {
        const list = [...ids];
        out.set(key, list.length === 1 ? { userId: list[0] } : { ambiguous: list });
    }
    return out;
}

/** The raiders with approved items, each with the items to send. */
function approvedPerPlayer(report) {
    const rec = applyReview(report.recommendations, report.recommendationReview);
    if (!rec) return [];
    return rec.players
        .map((p) => ({ name: p.name, type: p.type, items: p.items.filter((i) => i.approved === true) }))
        .filter((p) => p.items.length > 0);
}

const IMPACT_MARK = { high: "🔴", medium: "🟠", low: "🟢" };

/**
 * The DM for one raider: an embed with a field per approved point (the raid
 * lead's own wording wins over the generated one) and the link to their page.
 */
function buildRaiderMessage(report, player, items, { embed }) {
    const idx = (report.roster || []).findIndex((p) => p.name === player.name);
    const url = idx >= 0 ? `${publicBaseUrl}/r/${report.id}/p/${idx}` : `${publicBaseUrl}/r/${report.id}`;
    const e = embed()
        .setTitle(`Deine Auswertung: ${report.title || "Raid"}`)
        .setDescription(`Hallo ${player.name}, hier sind die Punkte aus dem Log${report.date ? ` vom ${String(report.date).split(",")[0]}` : ""}, die die Raidleitung für dich freigegeben hat.`)
        .setURL(url);
    for (const item of items.slice(0, 10)) {
        e.addFields({ name: `${IMPACT_MARK[item.impact] || "•"} ${item.title}`.slice(0, 256), value: String(item.custom || item.text || "–").slice(0, 1024) });
    }
    if (items.length > 10) e.addFields({ name: "…", value: `und ${items.length - 10} weitere Punkte auf deiner Seite.` });
    e.setFooter({ text: "Alle Details, Grafiken und dein Gear findest du auf deiner Spielerseite." });
    return { content: `Deine Auswertung ist da: ${url}`, embeds: [e] };
}

/** The signature of a raider's approved set, so an unchanged set is not sent twice. */
function sentSignature(items) {
    return items.map((i) => `${i.key}:${(i.custom || "").length}`).sort().join("|");
}

/**
 * Send every raider their approved points.
 *
 * @param {object} report
 * @param {object} deps  { discord (sendDirectMessage, embed), assignments (raiderCharactersStore.listAllAssignments()), by, force?, only?: string[] }
 * @returns {{ sent: Array, skipped: Array, report: object }}  the report carries the updated recommendationSent
 */
async function sendApproved(report, { discord, assignments, by = "", force = false, only = null }) {
    const owners = characterOwners(assignments);
    const record = report.recommendationSent || {};
    const sent = [];
    const skipped = [];
    const wanted = approvedPerPlayer(report).filter((p) => !only || only.includes(p.name));
    for (const p of wanted) {
        const owner = owners.get(p.name.toLowerCase());
        if (!owner) { skipped.push({ name: p.name, reason: "no_mapping", message: "Kein Discord-Konto zugeordnet (Einstellungen → Kategorien → Raider)." }); continue; }
        if (owner.ambiguous) { skipped.push({ name: p.name, reason: "ambiguous", message: `Mehrere Konten führen diesen Charakter (${owner.ambiguous.length}).` }); continue; }
        const signature = sentSignature(p.items);
        const previous = record[p.name];
        if (!force && previous && previous.signature === signature) { skipped.push({ name: p.name, reason: "already_sent", message: `Bereits gesendet am ${new Date(previous.at).toLocaleString("de-DE")}.` }); continue; }
        const payload = buildRaiderMessage(report, p, p.items, discord);
        const result = await discord.sendDirectMessage(owner.userId, payload);
        if (!result.ok) { skipped.push({ name: p.name, reason: "dm_failed", message: `DM fehlgeschlagen: ${result.error}` }); continue; }
        record[p.name] = { at: Date.now(), by, userId: owner.userId, keys: p.items.map((i) => i.key), signature, messageId: result.messageId || "" };
        sent.push({ name: p.name, userId: owner.userId, items: p.items.length });
    }
    report.recommendationSent = record;
    return { sent, skipped, report };
}

/** Per raider: how many points are approved, whether and when they were sent, and whether the set changed since. */
function sendStatus(report, assignments) {
    const owners = characterOwners(assignments);
    const record = report.recommendationSent || {};
    return approvedPerPlayer(report).map((p) => {
        const owner = owners.get(p.name.toLowerCase());
        const previous = record[p.name];
        const signature = sentSignature(p.items);
        return {
            name: p.name, type: p.type, approved: p.items.length,
            mapped: !!(owner && owner.userId), ambiguous: !!(owner && owner.ambiguous),
            sentAt: previous ? previous.at : null,
            changed: !!(previous && previous.signature !== signature),
        };
    });
}

module.exports = { characterOwners, approvedPerPlayer, buildRaiderMessage, sendApproved, sendStatus, sentSignature };
