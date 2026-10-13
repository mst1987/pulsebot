// The spec and class icons for the pictures the bot draws (the setup graphic):
// the wow.zamimg.com icons the spec emojis are made of, checked in under
// assets/specs/<icon>.jpg (scripts/fetch-spec-icons.js), handed out as data
// URIs - resvg draws no remote images, so the bytes have to be in the SVG.
// Read once per icon and kept; a missing file is "" and the builder draws its
// fallback instead.
const fs = require("fs");
const path = require("path");
const { buildClasses } = require("../../config/gameVersions/classes");

const ICON_DIR = path.join(__dirname, "..", "..", "..", "assets", "specs");
const CLASSES = buildClasses();
const CLASS_ICON = new Map(CLASSES.map((c) => [c.id, c.icon]));
const SPEC_ICON = new Map(CLASSES.flatMap((c) => c.specs.map((s) => [s.key, s.icon])));
const cache = new Map();

/** An icon file as a data URI, "" when there is none (an unknown name never leaves the folder). */
function iconDataUri(icon) {
    const name = String(icon || "");
    if (!/^[a-z0-9_]+$/.test(name)) return "";
    if (!cache.has(name)) {
        try {
            cache.set(name, `data:image/jpeg;base64,${fs.readFileSync(path.join(ICON_DIR, `${name}.jpg`)).toString("base64")}`);
        } catch {
            cache.set(name, "");
        }
    }
    return cache.get(name);
}

/** The icon of a raider's spec, else of their class (a raider without a spec), else "". */
function specIconDataUri(specKey, classId) {
    return iconDataUri(SPEC_ICON.get(specKey)) || iconDataUri(CLASS_ICON.get(classId || String(specKey || "").split("-")[0]));
}

module.exports = { ICON_DIR, iconDataUri, specIconDataUri };
