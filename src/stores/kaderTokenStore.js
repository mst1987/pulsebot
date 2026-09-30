// API tokens for the local Kaderbau app (roster builder, docs/kaderbau.md).
//
// The app runs on a raid lead's PC and pulls a read-only snapshot through
// GET /api/kader/export (apiRoutes/kader.js). It has no Discord session, so it
// authenticates with a bearer token like the loot-sync uploader does — same
// security model (bearerTokenStore.js), but a capability of its own: the prefix
// `ehk_` and the file `data/settings/kader-tokens.json`. A Kaderbau token can
// only read the export; a loot-sync token (`ehl_`, ingestTokenStore.js) is
// unknown here, and a Kaderbau token is unknown to the upload.
const { settingsPath } = require("../config/paths");
const { createBearerTokenStore } = require("./bearerTokenStore");

module.exports = createBearerTokenStore({
    file: settingsPath("kader-tokens.json"),
    prefix: "ehk_",
    defaultName: "Kaderbau",
});
