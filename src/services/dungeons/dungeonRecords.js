// "Neue Gildenrekorde posten" (Einstellungen → Dungeon-Bestzeiten, off by
// default): after a LevelHelper upload, a gold run that is now the fastest of
// its dungeon goes into the configured channel as a card (dungeonCards.recordCard,
// in the server language).
//
//   config.dungeonRecords = { post: boolean, channelId: string }
//
// Only runs that finished within RECORD_WINDOW_MS are posted — the first upload
// of an old run history must not flood the channel — at most MAX_POSTS per
// upload, and each run only once (recordPostedAt). A version the orga hid
// (#563) posts nothing. A failed post is logged, never retried.
const store = require("../../stores/dungeonRunStore");
const settingsStore = require("../../stores/settingsStore");
const discord = require("../discord/discord");
const { serverLang } = require("../discord/botLanguage");
const { isVersionVisible } = require("../versions/mainVersion");
const { runView } = require("./dungeonBoard");
const { recordCard } = require("./dungeonCards");
const logger = require("../../logger");

const RECORD_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_POSTS = 3;

/** The setting, normalised (configSchema keeps the same shape). */
function recordSetting(config) {
    const raw = (config && config.dungeonRecords) || {};
    return { post: raw.post === true, channelId: String(raw.channelId || "").trim() };
}

const byTime = (a, b) => a.seconds - b.seconds || a.start - b.start;

/**
 * The new records among the runs of an upload: per dungeon, the touched gold
 * run that is now the fastest stored run, finished recently, not posted yet.
 * @param {object[]} runs      the stored runs of the version
 * @param {string[]} touched   our ids of the runs the upload added or made faster
 * @returns {{ run: object, previous: number }[]}  previous = the best time of the other runs (0 = none)
 */
function newRecords(runs, touched, { now = Date.now() } = {}) {
    const fresh = new Set(touched || []);
    const dungeons = new Set(runs.filter((r) => fresh.has(r.id)).map((r) => r.dungeon));
    const out = [];
    for (const dungeon of dungeons) {
        const list = runs.filter((r) => r.dungeon === dungeon).sort(byTime);
        const best = list[0];
        if (!fresh.has(best.id) || best.medal !== "gold" || best.recordPostedAt) continue;
        if ((best.at || best.start) * 1000 < now - RECORD_WINDOW_MS) continue;
        const others = list.filter((r) => !fresh.has(r.id));
        out.push({ run: best, previous: others.length ? others[0].seconds : 0 });
    }
    return out.sort((a, b) => b.run.at - a.run.at).slice(0, MAX_POSTS);
}

/**
 * Post the new records of an upload, when the setting is on. Resolves with the
 * number of posts; never throws.
 */
async function postNewRecords({ versionId, touched }, { config, now = Date.now() } = {}) {
    try {
        const cfg = config || settingsStore.getConfig();
        const setting = recordSetting(cfg);
        if (!setting.post || !setting.channelId || !touched || !touched.length) return 0;
        if (!isVersionVisible(versionId, cfg)) return 0;
        const records = newRecords(store.listRuns(versionId), touched, { now });
        const lang = serverLang(cfg);
        const posted = [];
        for (const { run, previous } of records) {
            try {
                await discord.postPayload(setting.channelId, recordCard(lang, { versionId, run: runView(run), previous }));
                posted.push(run.id);
            } catch (e) {
                logger.warn(`[dungeons] Rekord ${run.dungeon} nicht in ${setting.channelId} gepostet: ${(e && e.message) || e}`);
            }
        }
        store.markRecordPosted(posted, now);
        return posted.length;
    } catch (e) {
        logger.warn(`[dungeons] Rekorde nicht geprüft: ${(e && e.message) || e}`);
        return 0;
    }
}

module.exports = { recordSetting, newRecords, postNewRecords, RECORD_WINDOW_MS, MAX_POSTS };
