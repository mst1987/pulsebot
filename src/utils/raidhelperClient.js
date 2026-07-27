const Raidhelper = require("../classes/raidhelper");
const { getConfig } = require("../web/settingsStore");

// Single place that knows about the admin-editable serverId override, so every
// call site gets it automatically without depending on web/settingsStore itself.
function createRaidhelperClient() {
    return new Raidhelper({ serverId: getConfig().raidhelperServerId });
}

module.exports = { createRaidhelperClient };
