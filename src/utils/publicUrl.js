// The public base url of the web menu (PUBLIC_BASE_URL), without a trailing
// slash, so `${publicBaseUrl()}/profile` never doubles the slash. Read at call
// time: config/variables stays the one place the env is read.
const variables = require("../config/variables");

/** "https://example.org" — PUBLIC_BASE_URL without trailing slashes, "" when unset. */
function publicBaseUrl() {
    return String(variables.publicBaseUrl || "").replace(/\/+$/, "");
}

module.exports = { publicBaseUrl };
