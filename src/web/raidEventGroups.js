// Shared by server.js's SSR raid routes and apiRoutes/raids.js: the guild's
// Raid-Helper events grouped by Discord category.
const Raidhelper = require("../classes/raidhelper");
const discord = require("./discord");

// How far back events are looked up when a past raid has to be found again — for
// the log→event assignment and for the event detail page, which the dashboard's
// "Latest Events" card links to.
const EVENT_LOOKBACK_DAYS = 60;
const eventLookbackSince = () => Math.floor(Date.now() / 1000) - EVENT_LOOKBACK_DAYS * 24 * 60 * 60;

// Fetch the guild's Raid-Helper events and group them by the Discord category
// their channel lives in. By default only UPCOMING events (Raid-Helper filters by
// start time); pass `sinceSeconds` to include raids that already took place.
// Returns { groups, error }.
async function loadEventGroups(guildId, { sinceSeconds } = {}) {
    if (!guildId) return { groups: [], error: null };
    try {
        const rh = new Raidhelper();
        const events = sinceSeconds ? await rh.fetchEvents(sinceSeconds) : await rh.getAllEvents();
        const catMap = discord.getChannelCategoryMap(guildId);
        const byCat = new Map();
        for (const ev of events) {
            const meta = catMap[ev.channelId];
            if (!meta) continue; // event channel not in this guild
            const key = meta.categoryId || "__none__";
            if (!byCat.has(key)) {
                byCat.set(key, { categoryId: meta.categoryId || "", categoryName: meta.categoryName || "Ohne Kategorie", events: [] });
            }
            byCat.get(key).events.push({
                id: ev.id,
                title: ev.title,
                startTime: ev.startTime,
                leaderId: ev.leaderId,
                channelId: ev.channelId,
                channelName: meta.name,
                categoryId: meta.categoryId || "",
                templateId: (ev.templateId !== null && ev.templateId !== undefined) ? String(ev.templateId) : "",
                description: ev.description || "",
                signupCount: (ev.signUps || []).filter((s) => s.specName !== "Absence").length,
                signUps: (ev.signUps || []).map((s) => ({ userId: s.userId, specName: s.specName })),
            });
        }
        const groups = [...byCat.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName));
        return { groups, error: null };
    } catch (e) {
        return { groups: [], error: (e && e.message) || "Events konnten nicht geladen werden (Raid-Helper API)." };
    }
}

module.exports = { EVENT_LOOKBACK_DAYS, eventLookbackSince, loadEventGroups };
