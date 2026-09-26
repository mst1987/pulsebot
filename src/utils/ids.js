// Ids: the shape of a Discord snowflake and random ids for stored records.
const crypto = require("crypto");

// Loose on purpose (5-25 digits): test fixtures use short ids, and a stored id
// only has to look like one; Discord decides whether it exists.
const SNOWFLAKE = /^\d{5,25}$/;

/** Whether a value looks like a Discord id (user, role, channel, guild). Not trimmed. */
const isSnowflake = (v) => SNOWFLAKE.test(String(v === null || v === undefined ? "" : v));

/** A random hex id of `bytes` bytes (two characters per byte). */
const newId = (bytes = 6) => crypto.randomBytes(bytes).toString("hex");

module.exports = { SNOWFLAKE, isSnowflake, newId };
