// The server time zone: the realm's (TBC Anniversary EU) and the one the raid
// times are entered in. Every Luxon zone and every toLocale*String timeZone in
// the backend reads this one constant.
//
// A module of its own, not only a field in variables.js: many tests replace
// config/variables with a small stub, and a zone missing there would silently
// fall back to the machine's zone.
const TIMEZONE = "Europe/Berlin";

module.exports = { TIMEZONE };
