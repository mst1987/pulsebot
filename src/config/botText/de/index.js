// The German texts of the bot, one file per area, keyed by the English source
// text the code passes to utils/i18n/botText.js `tr()`. A new area is a new file
// here plus one line below (test/config/botText/de.test.js loads each file and
// refuses the same English sentence with two different German ones).
const AREAS = [
    require("./common"),
    require("./availability"),
    require("./signup"),
    require("./profile"),
    require("./events"),
    require("./setup"),
    require("./talk"),
    require("./guildBank"),
];

const merged = {};
for (const area of AREAS) {
    for (const [en, de] of Object.entries(area)) {
        if (Object.prototype.hasOwnProperty.call(merged, en) && merged[en] !== de) {
            throw new Error(`botText/de: "${en}" has two German texts`);
        }
        merged[en] = de;
    }
}

module.exports = merged;
