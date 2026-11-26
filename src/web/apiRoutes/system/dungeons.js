// The page "Dungeon-Bestzeiten" (/roster/dungeons): the LevelHelper addon's group
// runs and achievement points the sync tool uploaded (POST /api/ingest/levelhelper).
//
//   GET /api/dungeons?version=   every table of the content switch's version
//                                (services/dungeons/dungeonBoard.js): dungeons with
//                                their ten fastest runs, the overall medal ranking,
//                                the achievement points — never another version
//                                (#741); `otherVersions` (short names) names the
//                                versions that have data, for the empty page
//
// While the feature "dungeonTimes" is off for the version (versionCapabilities.js,
// Einstellungen → Spielversion) the answer is still 200, but with empty tables and
// `off: true` — `offReason` "disabled" when the orga switched it off, else why it is
// not possible ("no_dungeon_times": no LevelHelper for that client); the page shows
// a hint instead of the tables. `otherVersions` then and always names only versions
// with the feature on. The upload (POST /api/ingest/levelhelper) keeps storing.
//
// Readable with "roster" (the orga) or "signup" (every member's base access):
// a guild leaderboard is for the whole guild. Nothing on the page writes.
const { ok } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { resolveVersionQuery, isVersionVisible } = require("../../../services/versions/mainVersion");
const { versionShort } = require("../../../services/versions/versionTag");
const { getConfig } = require("../../../stores/settings/settingsStore");
const { dungeonBoard, versionsWithData } = require("../../../services/dungeons/dungeonBoard");
const { featureState, featureOn } = require("../../../services/versions/versionCapabilities");

/** GET /api/dungeons — the tables of one version. */
const getDungeons = withUser(async ({ res, query }) => {
    const config = getConfig();
    const { versionId } = resolveVersionQuery(query.get("version"), { config });
    const otherVersions = versionsWithData()
        .filter((v) => v !== versionId && isVersionVisible(v, config) && featureOn(v, "dungeonTimes", { config }))
        .map(versionShort);
    const state = featureState(versionId, "dungeonTimes", { config });
    if (!state.on) {
        return ok(res, {
            versionId, dungeons: [], players: [], characters: [], totals: { runs: 0, characters: 0 }, updatedAt: 0,
            off: true, offReason: state.reason, otherVersions,
        });
    }
    ok(res, { ...dungeonBoard(versionId), otherVersions });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/dungeons", handler: getDungeons, area: ["roster", "signup"] },
];

module.exports = { getDungeons, routes };
