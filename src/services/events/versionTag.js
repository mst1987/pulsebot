// The small version label on a bot post (#743): TBC and Forever run on the same
// Discord server, so a raid post names its version ("TBC", "Forever"). Left
// out while only one version is visible (hideOtherVersions) - nothing to tell
// apart then.
const { rulesFor } = require("../../config/gameVersions");
const { versionOfEvent, visibleVersions } = require("./mainVersion");

/** The short name of a version ("Forever"), its id when unknown. */
function versionShort(versionId) {
    const rules = rulesFor(versionId);
    return (rules && (rules.short || rules.label)) || String(versionId || "");
}

/** The label a raid post carries, "" when the versions need no telling apart. */
function eventVersionTag(event, { config } = {}) {
    if (!event || visibleVersions(config).length < 2) return "";
    return versionShort(versionOfEvent(event, { config }));
}

module.exports = { versionShort, eventVersionTag };
