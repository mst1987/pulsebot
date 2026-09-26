// Source readers shared by the loot council's client tests
// (src/web-client/src/pages/LootCouncilPage.tsx + pages/lootcouncil/*).
// There is no React test renderer in this project, so the checks are on the
// source: structure, classes, and the invariants that would rot silently.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
// Line endings normalised: a Windows checkout has CRLF.
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

const files = {
    page: read("pages", "LootCouncilPage.tsx"),
    council: read("pages", "lootcouncil", "council.ts"),
    parts: read("pages", "lootcouncil", "parts.tsx"),
    filterBar: read("pages", "lootcouncil", "FilterBar.tsx"),
    roster: read("pages", "lootcouncil", "RosterList.tsx"),
    dialog: read("pages", "lootcouncil", "RaiderDialog.tsx"),
    drop: read("pages", "lootcouncil", "DropCheckPage.tsx"),
    css: read("styles", "loot-council.css"),
    app: read("App.tsx"),
    api: read("api", "lootcouncil.ts"),
    jobs: read("components", "Jobs.tsx"),
};

/** The body of one top-level function (exported or not) in a source. */
function fn(src, name) {
    const m = src.match(new RegExp(`\\n(?:export )?(?:default )?(?:async )?function ${name}\\b[\\s\\S]*?\\n}\\n`));
    if (!m) throw new Error(`function ${name} not found`);
    return m[0];
}

/** One CSS rule's declarations. */
function rule(css, selector) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
    if (!m) throw new Error(`rule ${selector} not found`);
    return m[1];
}

module.exports = { files, fn, rule, read };
