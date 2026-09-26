// Formatters of the legacy Raid-Helper signup command (/signup).
const { entryFor } = require("../config/classlist.js");
const { getCharacterIcon } = require("./discord/reply");

/** The class icons of the given specs as one line of server emojis. */
function formatSignUps(interaction, specs) {
    return specs
        .map((s) => `${getCharacterIcon(interaction, s.specName)}`)
        .join("");
}

/**
 * A comma-separated spec list ("Holy1,Fury") as Raid-Helper signup entries
 * `{ className, specName }`, at most ten; unknown specs are skipped.
 */
function formatSpecs(specs, templateId) {
    if (!specs) return [];
    return specs.split(",").slice(0, 10).flatMap((spec) => {
        const entry = entryFor(spec);
        if (!entry) return [];
        // Raid-Helper template 40 (Season of Discovery) sorts by role
        // instead of class; every other template wants its class name.
        const className = templateId === "40" ? (entry.role || undefined) : entry.raidhelperClass;
        return [{ className, specName: entry.spec }];
    });
}

module.exports = {
    formatSignUps,
    formatSpecs,
};
