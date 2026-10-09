// The old name of config/councilSpecs.js, from when the loot council knew
// casters and healers only (#669 added tanks, melee and hunters). Kept as an
// alias so a module still requiring it — a branch that was written against the
// old name — keeps working; new code requires councilSpecs.js.
module.exports = require("./councilSpecs");
