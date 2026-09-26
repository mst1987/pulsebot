// Source readers shared by the loot council's client tests
// (src/web-client/src/pages/lootcouncil/LootCouncilPage.tsx + pages/lootcouncil/*).
// There is no React test renderer in this project, so the checks are on the
// source: structure, classes, and the invariants that would rot silently.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
// Line endings normalised: a Windows checkout has CRLF.
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

// A file list read as one source: the page and the shared parts are split
// into several files each (#438), the checks look at them as a whole.
const readAll = (names) => names.map((f) => read("pages", "lootcouncil", f)).join("\n");

/** The page: its component, its tabs and the view it keeps. */
const PAGE_FILES = ["LootCouncilPage.tsx", "view.ts", "CouncilTabs.tsx", "RosterTab.tsx", "GapsTab.tsx", "GapCard.tsx", "Part.tsx", "BisListsTab.tsx", "CompareTab.tsx"];
/** The building blocks both routes draw (formerly parts.tsx). */
const PART_FILES = ["RichTip.tsx", "NeedBar.tsx", "ItemBits.tsx", "GearBadges.tsx", "CandidateTable.tsx"];

const files = {
    page: readAll(PAGE_FILES),
    council: read("pages", "lootcouncil", "council.ts"),
    parts: readAll(PART_FILES),
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

module.exports = { files, fn, rule, read, PAGE_FILES, PART_FILES };
