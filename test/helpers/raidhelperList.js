// Puts Raid-Helper event ids on a server's synced list (#925).
//
// Since rights hold per server, withUser answers 404 for a raid whose server
// nobody knows (services/events/eventServer.js, fail closed). A Raid-Helper
// event is known through its snapshot or through the synced list of a server
// (stores/events/raidhelperEventsStore.js, filled by raidhelperSync.js). A test that
// means "a Raid-Helper event of this server" puts its id there first.
const raidhelperEventsStore = require("../../src/stores/events/raidhelperEventsStore");
const { tempStoreFile } = require("./tempStore");

/**
 * Points the store at a scratch file holding `ids` on `guildId`'s list.
 * @returns {() => void} restores the store's default file
 */
function onSyncedList(guildId, ids) {
    raidhelperEventsStore.useFile(tempStoreFile("raidhelper-events.json"));
    raidhelperEventsStore.saveSnapshot(guildId, { syncedAt: 1, since: 0, events: ids.map((id) => ({ id: String(id) })) });
    return () => raidhelperEventsStore.useFile();
}

module.exports = { onSyncedList };
