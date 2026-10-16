// The raid categories a Kader counts attendance in (`kader.attendanceCategories`),
// seen from outside the Kaderplaner (#744): when a category is closed for good
// ("Kategorie abschließen", services/events/categoryLifecycle.js) it leaves
// every Kader of every server. The answer names the Kader only (id and name) —
// nothing of its players leaves through here, and nothing is logged.
const kaderStore = require("../../stores/kaderStore");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** Every server the planner file holds a planner for. */
function plannerKeys() {
    try {
        return kaderStore.plannerGuildKeys();
    } catch {
        return [];
    }
}

/**
 * The Kader that count a category: `[{ guildId, kaderId, name }]`.
 * @param {string} categoryId
 */
function kadersCountingCategory(categoryId) {
    const id = str(categoryId);
    if (!id) return [];
    const out = [];
    for (const guildId of plannerKeys()) {
        for (const k of kaderStore.readPlanner(guildId).kaders) {
            if ((k.attendanceCategories || []).includes(id)) out.push({ guildId, kaderId: k.id, name: k.name });
        }
    }
    return out;
}

/**
 * Take a category out of every Kader's attendance categories. Returns how many
 * Kader changed.
 * @param {string} categoryId
 */
function dropAttendanceCategory(categoryId) {
    const id = str(categoryId);
    if (!id) return 0;
    let changed = 0;
    for (const guildId of plannerKeys()) {
        const planner = kaderStore.readPlanner(guildId);
        let hit = false;
        for (const k of planner.kaders) {
            if (!(k.attendanceCategories || []).includes(id)) continue;
            k.attendanceCategories = k.attendanceCategories.filter((c) => c !== id);
            hit = true;
            changed += 1;
        }
        if (hit) kaderStore.writePlanner(guildId, planner);
    }
    return changed;
}

module.exports = { kadersCountingCategory, dropAttendanceCategory };
