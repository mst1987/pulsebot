// API tokens for the loot-sync companion tool (see the EventHelper addon repo).
//
// The uploader runs on a raidleader's PC and has no Discord session, so it
// authenticates with a bearer token instead. The security model (sha256 at
// rest, shown once, constant-time check, immediate revoke, own file) lives in
// bearerTokenStore.js, shared with the Kaderbau tokens (kaderTokenStore.js).
//
// Scoped to a single capability: uploading loot into the inbox. A token can
// never read or change anything else (see apiAccess.js's TOKEN_AUTH), and a
// Kaderbau token is unknown here — its own prefix and its own file.
const { settingsPath } = require("../config/paths");
const { createBearerTokenStore } = require("./bearerTokenStore");

// Recognisable prefix so a token found in a log or a pasted config is obviously
// an EventHelper loot-sync credential and can be revoked without guesswork.
module.exports = createBearerTokenStore({
    file: settingsPath("ingest-tokens.json"),
    prefix: "ehl_",
    defaultName: "Loot-Sync",
});
