// How the raider who won a loot row plays — class, spec, class colour and spec
// icon, attached to the row for anything that renders their name.
//
// The stored loot row itself only carries a character name: what the export
// knew about their class is remembered separately (characterStore.js, fed by
// the import and by the log evaluations), because a raider's class is a fact
// about them and not about one item they got. So it is joined back on read.
//
// Colour and icon are resolved server-side, like every other class colour in
// the app — the client never owns a second copy of the palette (see
// web-client's ClassSpec.tsx). A character nobody has resolved yet simply keeps
// empty fields and renders uncoloured.
const { characterMap } = require("./characterStore");
const { characterProfile } = require("../utils/setupView");

/**
 * The class look of one character, from a map read once for the whole list.
 * @param {object} known characterMap(): key -> stored record
 * @param {string} key   the row's characterKey
 */
function classLook(known, key) {
    const info = (known || {})[key] || null;
    const look = info && info.className ? characterProfile(info.className, info.spec) : null;
    // All four fields stand or fall together: a spec without a class colours
    // nothing and labels nothing ("Fury" alone is not a class), so it is not
    // handed out on its own.
    if (!look) return { className: "", spec: "", classColor: "", specIconUrl: "" };
    return {
        className: look.className || "",
        spec: (info && info.spec) || "",
        classColor: look.classColor || "",
        specIconUrl: look.iconUrl || "",
    };
}

/**
 * Adds the class look to every loot row. Reads the character store once for the
 * whole list rather than per row.
 * @param {object[]} items
 */
function withClassLook(items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return list;
    const known = characterMap();
    return list.map((it) => ({ ...it, ...classLook(known, it.characterKey) }));
}

module.exports = { withClassLook, classLook };
