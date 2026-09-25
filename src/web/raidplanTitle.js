// What an event's NAME says about its raid (docs/raidplan.md, "Raid-Helper events"): a Raid-Helper event carries no instance, size or
// game version of its own, but its title usually names the raid ("BT 25er Montag", "Kara + Gruul"). instancesFromTitle() reads it with
// the title keywords the softres.it integration already uses (config/softresInstances.js), SAFE ones only: short tokens that are also
// ordinary words or other abbreviations ("gl", "mag", "aman", "plateau", "serpent", "tempest", "mh") are left out. Several instances may
// match ("Kara + Gruul"); nothing sure = nothing. The raid plan's activation dialog shows it pre-filled and lets the orga correct it.
const { INSTANCES } = require("../config/softresInstances");
const { rulesFor } = require("../config/gameVersions");

// softres.it instance code -> the rule set's instance id (TBC)
const TBC_ID = { kara: "kara", gruul: "gruul", magtheridon: "mag", za: "za", ssc: "ssc", tempestkeep: "tk", blacktemple: "bt", hyjal: "hyjal", sunwellplateau: "swp" };
// title keywords that are not sure enough to name a raid by themselves
const UNSAFE = new Set(["gl", "mag", "aman", "plateau", "serpent", "tempest", "mh"]);

function normalize(title) {
    return String(title || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’`]/g, "");
}

/** Whether `keyword` stands in the normalised title as a word of its own ("bt" in "bt-25", never inside "abtei"). */
function hasWord(norm, keyword) {
    const k = normalize(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${k}([^a-z0-9]|$)`).test(norm);
}

/**
 * The instances a title names (rule-set ids, in raid order), the size it names ("10er", "25 man", "(25)"), else the default size of
 * the (largest) instance, and the game version ("tbc"). `{ instanceIds: [], size: 0, versionId }` when nothing is sure.
 */
function instancesFromTitle(title, versionId = "tbc") {
    const rules = rulesFor(versionId || "tbc") || rulesFor("tbc");
    const norm = normalize(title);
    const out = { instanceIds: [], size: 0, versionId: rules.id || "tbc" };
    // only the TBC keywords are mapped to rule-set ids so far; other versions are picked by hand
    if (!norm || out.versionId !== "tbc") return out;
    for (const [code, inst] of Object.entries(INSTANCES)) {
        const id = TBC_ID[code];
        if (!id || inst.edition !== "tbc") continue;
        if ((inst.keywords || []).some((kw) => !UNSAFE.has(kw) && hasWord(norm, kw))) out.instanceIds.push(id);
    }
    // in the rule set's order (Kara before Gruul ...)
    const order = (rules.instances || []).map((i) => i.id);
    out.instanceIds.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const sized = norm.match(/(^|[^0-9])(10|25|40)\s*(er|man|m\b|-man|\))/) || norm.match(/\((10|25|40)\)/);
    const named = sized ? Number(sized[2] || sized[1]) : 0;
    const defaults = out.instanceIds.map((id) => ((rules.instances || []).find((i) => i.id === id) || {}).defaultSize || 0);
    out.size = named || (defaults.length ? Math.max(...defaults) : 0);
    return out;
}

module.exports = { instancesFromTitle, TBC_ID };
