// "Loot verteilen" in the setup proposal (#1037): who wants which loot, so the
// proposal spreads raiders who want the same items over the parallel raids of a
// raid group (#811). Two halves:
//
//   loadLootData(eventIds)  the background job behind "Loot-Daten laden": reads
//                           softres.it (fetchRaidCached, one read per list), the
//                           BiS lists of the specs (WoWSims data, TBC only) and the
//                           gear the characters wear (armory one after another,
//                           with its own cache, then the logs) and stores one
//                           snapshot per raid group (setupLootStore). The only
//                           place that calls an API.
//   lootInputFor(events)    cheap, on every editor move: the stored snapshot when it
//                           still fits the raids (same version, same instances),
//                           else null - the proposal itself never calls an API.
//
// First source wins per character (utils/setup/lootWants.js): Softres, else BiS
// minus what is worn, else the spec. Forever has no item-to-instance table (the
// BiS lists of #760 name no drop), so it gets Softres and the spec only; an item
// the TBC table does not know keeps no name ("Item <id>" in the editor).

const eventStore = require("../../stores/events/eventStore");
const signupStore = require("../../stores/events/signupStore");
const settingsStore = require("../../stores/settings/settingsStore");
const { getEventSoftres } = require("../../stores/events/eventSoftresStore");
const { getSetupLoot, saveSetupLoot } = require("../../stores/loot/setupLootStore");
const { versionOfEvent } = require("../versions/mainVersion");
const { signupEventIdOf } = require("../../utils/raidGroup");
const { rulesFor } = require("../../config/gameVersions");
const { lootWants } = require("../../utils/setup/lootWants");
const { characterKeyOf } = require("../../utils/loot/lootImport");
const { iconUrl } = require("../../utils/loot/wowhead");
const { specByKey, bisForSpec } = require("../../config/data/councilSpecs");
const tbcContent = require("../../config/data/tbcContent");
const raidContent = require("../../config/data/raidContent");
const { itemMeta } = require("../../config/data/tbcLootNames");
const softresStatus = require("../loot/softresStatus");
const armoryGear = require("../loot/armoryGear");
const charGear = require("../loot/charGear");
const logger = require("../../logger").child("setupLoot");

// One run asks the armory for at most this many characters; the rest keep what the logs say.
const MAX_ARMORY = 80;
const TBC = "tbc";

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

/** The instances of the raids, sorted and once each. */
function instancesOf(events) {
    return [...new Set(events.flatMap((e) => (Array.isArray(e && e.instanceIds) ? e.instanceIds : []).map(str).filter(Boolean)))].sort();
}

/** The characters of a signup with a spec (the setup's own reading, model.js signupCharacters). */
function signupCharacters(s) {
    const list = Array.isArray(s.characters) ? s.characters.filter((c) => c && str(c.spec) && str(c.character)) : [];
    if (list.length) return list.map((c) => ({ character: str(c.character), spec: str(c.spec) }));
    return str(s.character) ? [{ character: str(s.character), spec: str(s.spec) }] : [];
}

/**
 * The stored loot data for the proposal, or null: one raid only (nothing to spread),
 * nothing loaded yet, or loaded for another version or other instances (the raids
 * changed since - stale data would spread the wrong loot). Reads one store file.
 */
function lootInputFor(events, { config } = {}) {
    const list = (events || []).filter(Boolean);
    if (list.length < 2) return null;
    const snapshot = getSetupLoot(signupEventIdOf(list[0]));
    if (!snapshot || !snapshot.versionId) return null;
    if (snapshot.versionId !== versionOfEvent(list[0], { config })) return null;
    const instances = instancesOf(list);
    if (instances.join("|") !== (snapshot.instanceIds || []).join("|")) return null;
    return { versionId: snapshot.versionId, wants: snapshot.wants || {}, items: snapshot.items || {} };
}

// The job's progress per raid group (signup event id): { done, total } of the armory pass.
const progress = new Map();

/** The armory progress of a running job, or null. */
function progressOf(id) {
    return progress.get(str(id)) || null;
}

/** Item ids of a reserve: numbers or `{ id }` objects (softres.it answers both). */
function reserveItems(reserve) {
    return (Array.isArray(reserve && reserve.items) ? reserve.items : [])
        .map((x) => Number(x && typeof x === "object" ? x.id : x))
        .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * The Softres reserves of every list of the raids, per user and character key.
 * One expected entry per character, so a raider who reserved on two characters keeps
 * both; a reserve found only by the Discord id goes to the character it was paired with.
 */
async function softresByCharacter(events, raiders) {
    const out = new Map();
    const expected = raiders.flatMap((r) => r.chars.map((c) => ({ userId: r.userId, names: [c.character], label: c.character })));
    const ids = [...new Set([signupEventIdOf(events[0]), ...events.map((e) => e.id)])];
    for (const id of ids) {
        const sr = getEventSoftres(id);
        if (!sr || !sr.raidId) continue;
        let raid;
        try {
            raid = await softresStatus.fetchRaidCached(sr.raidId, sr.token || "");
        } catch (e) {
            logger.warn(`softres ${sr.raidId}: ${e.message}`);
            continue;
        }
        if (!raid || (raid.hideReserves && !raid.isManager)) continue;
        const { matched } = softresStatus.matchReserves(expected, Array.isArray(raid.reserves) ? raid.reserves : []);
        for (const { raider, reserve } of matched) {
            const items = reserveItems(reserve);
            if (!items.length) continue;
            const key = `${raider.userId}|${characterKeyOf(raider.label)}`;
            out.set(key, [...new Set([...(out.get(key) || []), ...items])]);
        }
    }
    return out;
}

/** The BiS items of a spec that drop in these instances (TBC drop table), or []. */
function bisInInstances(specKey, versionId, instances) {
    if (versionId !== TBC) return [];
    const spec = specByKey(specKey);
    if (!spec) return [];
    const inside = new Set(instances);
    const tiers = [...new Set(instances.map((id) => (tbcContent.content(id) || {}).tier).filter(Boolean))];
    const ids = new Set();
    for (const tier of tiers) {
        for (const item of bisForSpec(spec, tier).items || []) {
            const id = Number(item && item.id);
            const source = id ? raidContent.sourceForItem(id, { versionId }) : null;
            if (source && inside.has(source.content)) ids.add(id);
        }
    }
    return [...ids];
}

/** Name, icon and quality of the items in the wants - from the TBC table only. */
function itemTable(wants, versionId) {
    const items = {};
    for (const byChar of Object.values(wants)) {
        for (const entry of Object.values(byChar)) {
            for (const { itemId } of entry.items) {
                if (typeof itemId !== "number" || items[itemId]) continue;
                const meta = versionId === TBC ? itemMeta(itemId) : null;
                items[itemId] = meta ? { name: meta[0] || "", icon: iconUrl(meta[1]), quality: Number(meta[2]) || null } : { name: "", icon: "", quality: null };
            }
        }
    }
    return items;
}

/**
 * The background job of "Loot-Daten laden" (evalJobs, section "setup-loot"):
 * gathers and stores the loot data of a raid group. Never throws.
 * @returns {Promise<{ ok: boolean, error?: string, counts?: object }>}
 */
async function loadLootData(eventIds) {
    const events = [...new Set((eventIds || []).map(str).filter(Boolean))].map((id) => eventStore.getEvent(id)).filter(Boolean);
    if (events.length < 2) return { ok: false, error: "Loot verteilen gibt es nur bei mehreren Raids gleichzeitig." };
    const config = settingsStore.getConfig();
    const versionId = versionOfEvent(events[0], { config });
    if (!versionId || !rulesFor(versionId)) return { ok: false, error: "Die Spielversion des Raids ist unbekannt." };
    const groupId = signupEventIdOf(events[0]);
    const guildId = events[0].guildId;
    const instances = instancesOf(events);
    try {
        const raiders = [];
        for (const s of signupStore.listSignups(groupId)) {
            if (!s || !s.userId || s.status === "absence") continue;
            const chars = signupCharacters(s);
            if (chars.length) raiders.push({ userId: str(s.userId), chars });
        }
        const reserves = await softresByCharacter(events, raiders);

        // BiS first, so the armory is asked only for characters a BiS list could matter for.
        const bis = new Map();
        for (const r of raiders) for (const c of r.chars) {
            const list = bisInInstances(c.spec, versionId, instances);
            if (list.length && !reserves.has(`${r.userId}|${characterKeyOf(c.character)}`)) bis.set(`${r.userId}|${characterKeyOf(c.character)}`, { name: c.character, list });
        }
        const names = [...new Set([...bis.values()].map((b) => b.name))].slice(0, MAX_ARMORY);
        progress.set(groupId, { done: 0, total: names.length });
        for (const name of names) {
            const asked = await armoryGear.primeArmoryGear([name], { full: true, versionId, guildId });
            const p = progress.get(groupId);
            progress.set(groupId, { ...p, done: p.done + 1 });
            // no armory for this version (no realm, no key): the logs still know some gear
            if (!asked.configured) break;
        }
        const gear = bis.size ? charGear.gearByCharacter({ versionId, guildId }) : new Map();

        const wants = {};
        const counts = { signups: raiders.length, gear: 0, softres: 0, bis: 0, spec: 0 };
        for (const r of raiders) {
            let hasGear = false;
            const sources = new Set();
            for (const c of r.chars) {
                const key = characterKeyOf(c.character);
                const snap = gear.get(key);
                const worn = snap && Array.isArray(snap.items) ? snap.items.map((it) => Number(it.itemId)).filter(Boolean) : null;
                if (worn) hasGear = true;
                const own = bis.get(`${r.userId}|${key}`);
                const entry = lootWants(r.userId, c.character, { reserves: reserves.get(`${r.userId}|${key}`), bis: own ? own.list : [], worn, spec: c.spec });
                if (!entry) continue;
                (wants[r.userId] = wants[r.userId] || {})[key] = entry;
                sources.add(entry.source);
            }
            if (hasGear) counts.gear++;
            const best = ["softres", "bis", "spec"].find((x) => sources.has(x));
            if (best) counts[best]++;
        }
        saveSetupLoot(groupId, { versionId, instanceIds: instances, wants, items: itemTable(wants, versionId), counts });
        return { ok: true, counts };
    } catch (e) {
        logger.error(`loot data ${groupId}: ${e.message}`);
        return { ok: false, error: "Loot-Daten konnten nicht geladen werden." };
    } finally {
        progress.delete(groupId);
    }
}

module.exports = { lootInputFor, loadLootData, progressOf, MAX_ARMORY, _internal: { bisInInstances, reserveItems, signupCharacters, itemTable } };
