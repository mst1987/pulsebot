// A fingerprint of what `scripts/register-commands.js` would send to Discord:
// the command definitions plus where they go (application, servers or global).
// deploy.sh keeps the last registered fingerprint in its state file and only
// registers again when it changed - before, every deploy loaded every command
// module and PUT the whole list on every server, although it changes rarely.
//
// The same definitions always give the same hash: object keys are sorted at
// every level (a builder may emit them in any order), arrays keep their order
// (option order is part of a command), and the server list is sorted (the
// order of the servers is not).
const crypto = require("crypto");

/** JSON with the keys of every object sorted; undefined members are left out like JSON.stringify does. */
function stableStringify(value) {
    if (value === null || typeof value !== "object") {
        const json = JSON.stringify(value);
        return json === undefined ? "null" : json;
    }
    if (typeof value.toJSON === "function") return stableStringify(value.toJSON());
    if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
    const keys = Object.keys(value).filter((k) => value[k] !== undefined && typeof value[k] !== "function").sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/**
 * The sha256 (hex) of the registration: `body` (the definitions), `clientId`,
 * `guildIds` (order does not matter) and `global`. A new server in the
 * settings therefore counts as a change as much as a new option does.
 */
function commandsHash({ body = [], clientId = "", guildIds = [], global = false } = {}) {
    const targets = global ? ["global"] : [...new Set(guildIds.map((id) => String(id)))].sort();
    const input = stableStringify({ v: 1, clientId: String(clientId || ""), targets, body });
    return crypto.createHash("sha256").update(input).digest("hex");
}

module.exports = { stableStringify, commandsHash };
