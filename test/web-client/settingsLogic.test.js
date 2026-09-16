// The rules behind the Einstellungen page (src/web-client/src/lib/settingsLogic.ts):
// the tri-state cells of the permission matrix, the save bar's change list, the
// connection cards' status and the PATCH body of a connection modal.
//
// The client is TypeScript and the tests run plain Node without a compiler, so
// the module is written to be strippable (see the note at its top) and loaded
// here by removing exactly the syntax it is allowed to use: `import type`,
// `export type` declarations, and the annotations of a one-line signature or a
// top-level const.
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "..", "src", "web-client", "src", "lib", "settingsLogic.ts");

/** Split a parameter list at its top-level commas. */
function splitParams(list) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c === "=" && list[i + 1] === ">") { cur += "=>"; i++; continue; }
        if ("(<{[".includes(c)) depth++;
        if (")>}]".includes(c)) depth--;
        if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
        cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out;
}

function stripTypes(src) {
    const lines = src.split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^import type /.test(line)) continue;
        if (/^export type /.test(line)) {
            // A type declaration ends at the first line closing with ";" at depth 0.
            let depth = 0;
            for (; i < lines.length; i++) {
                for (const c of lines[i]) { if ("({[".includes(c)) depth++; if (")}]".includes(c)) depth--; }
                if (depth === 0 && /;\s*$/.test(lines[i])) break;
            }
            continue;
        }
        const fn = line.match(/^(export )?function (\w+)\((.*)\)(: .*)? \{$/);
        if (fn) {
            const params = splitParams(fn[3]).map((p) => p.trim().split(":")[0].replace("?", "").trim()).filter(Boolean);
            out.push(`function ${fn[2]}(${params.join(", ")}) {`);
            continue;
        }
        const constant = line.match(/^(export )?const (\w+): .+? = (.*)$/);
        if (constant) { out.push(`const ${constant[2]} = ${constant[3]}`); continue; }
        out.push(line.replace(/^export /, ""));
    }
    return out.join("\n");
}

function load() {
    // LF regardless of the checkout: git's autocrlf hands Windows the file with CRLF
    const js = stripTypes(fs.readFileSync(FILE, "utf8").replace(/\r\n/g, "\n"));
    const names = [...js.matchAll(/^(?:function|const) (\w+)/gm)].map((m) => m[1]);
    return new Function(`${js}\nreturn { ${names.join(", ")} };`)();
}

const logic = load();

describe("settingsLogic loader", () => {
    it("finds the functions the page uses", () => {
        for (const name of ["levelOf", "nextLevel", "withLevel", "areaCounts", "isDiscordId", "permissionChanges",
            "draftChanges", "connectionState", "connectionPatch", "categoryRows", "splitCategoryRows"]) {
            expect({ name, type: typeof logic[name] }).toEqual({ name, type: "function" });
        }
    });
});

describe("permission matrix cells", () => {
    it("cycles aus › Lesen › Schreiben › aus", () => {
        expect(logic.nextLevel("none")).toBe("read");
        expect(logic.nextLevel("read")).toBe("write");
        expect(logic.nextLevel("write")).toBe("none");
    });

    it("stores Schreiben with Lesen included, so the rule holds without a second switch", () => {
        expect(logic.withLevel({}, "raids", "write")).toEqual({ raids: { read: true, write: true } });
        expect(logic.withLevel({}, "raids", "read")).toEqual({ raids: { read: true, write: false } });
    });

    it("reads a legacy write-only grant as Schreiben", () => {
        expect(logic.levelOf({ read: false, write: true })).toBe("write");
        expect(logic.levelOf(undefined)).toBe("none");
    });

    it("drops the area entry on the way back to aus instead of storing two falses", () => {
        const grants = { raids: { read: true, write: true }, cla: { read: true, write: false } };
        const back = logic.withLevel(grants, "raids", logic.nextLevel(logic.levelOf(grants.raids)));
        expect(back).toEqual({ cla: { read: true, write: false } });
        // ...and never mutates what it was handed
        expect(grants.raids).toEqual({ read: true, write: true });
    });

    it("counts read and write holders per column", () => {
        const maps = [{ loot: { read: true, write: false } }, { loot: { read: true, write: true } }, {}];
        expect(logic.areaCounts(maps, "loot")).toEqual({ read: 1, write: 1 });
    });

    it("checks a Discord id as a 17–20 digit snowflake", () => {
        expect(logic.isDiscordId("123456789012345678")).toBe(true);
        expect(logic.isDiscordId(" 12345678901234567 ")).toBe(true);
        expect(logic.isDiscordId("1234")).toBe(false);
        expect(logic.isDiscordId("abc456789012345678")).toBe(false);
    });
});

describe("save bar change list", () => {
    const names = {
        role: (id) => `@${id}`,
        user: (id) => `Konto ${id}`,
        area: (id) => ({ history: "Historie", channels: "Kanäle" }[id] || id),
        category: (id) => ({ c1: "Hyjal & BT" }[id] || id),
    };
    const base = () => ({
        adminRoleIds: ["a1"], rolePermissions: { raidlead: { history: { read: true, write: false } } },
        baseAccess: {}, userPermissions: {},
        officerRoleId: "", applicationChannelId: "", highestBidsChannelId: "", highestBidsMessageId: "",
        categoryIds: ["c1"], categoryRoles: { c1: ["r1", "r2"] }, logChannelIds: ["l1", "l2"],
        raidChannelId: "",
        categoryLootTool: {}, categorySheets: {}, categoryRaidTemplate: { c1: "tpl1" }, topItems: [{ id: 1 }],
    });

    it("names a changed default raid template per category, and ignores an emptied entry", () => {
        const draft = base();
        draft.categoryRaidTemplate = { c1: "tpl2", c9: "" };
        expect(logic.draftChanges(base(), draft, names)).toEqual(["Hyjal & BT · Standard-Vorlage"]);
    });

    it("is empty when nothing changed, even if the order of a list or an empty entry differs", () => {
        const draft = base();
        draft.categoryRoles = { c1: ["r2", "r1"] };
        draft.logChannelIds = ["l2", "l1"];
        draft.categoryLootTool = { c1: "" };
        draft.categorySheets = { c1: { url: " ", name: "" } };
        expect(logic.draftChanges(base(), draft, names)).toEqual([]);
    });

    it("names each change once", () => {
        const draft = base();
        draft.rolePermissions = { raidlead: { history: { read: true, write: true }, channels: { read: true, write: false } } };
        draft.categoryLootTool = { c1: "gargul" };
        draft.officerRoleId = "o1";
        const changes = logic.draftChanges(base(), draft, names);
        expect(changes).toEqual([
            "@raidlead · Historie → Schreiben",
            "@raidlead · Kanäle → Lesen",
            "Hyjal & BT · Loot-Addon → Gargul",
            "Offizier-Rolle",
        ]);
    });

    it("counts admin roles, the base access, accounts, categories and top items", () => {
        const draft = base();
        draft.adminRoleIds = ["a2"];
        draft.baseAccess = { loot: { read: true, write: false } };
        draft.userPermissions = { u1: {} };
        draft.categoryIds = [];
        draft.topItems = [];
        expect(logic.draftChanges(base(), draft, names)).toEqual([
            "Admin-Rolle @a1 entfernt",
            "Admin-Rolle @a2 hinzugefügt",
            "Basiszugang · loot → Lesen",
            "Konto u1 hinzugefügt",
            "Hyjal & BT deaktiviert",
            "Top-Items",
        ]);
    });
});

describe("connection cards", () => {
    it("says what is missing for a client + secret connection", () => {
        expect(logic.connectionState("wcl", { warcraftlogsV2: { clientId: "x", hasClientSecret: false } }))
            .toEqual({ tone: "mid", label: "Secret fehlt", missing: true });
        expect(logic.connectionState("battlenet", { blizzard: { clientId: "x", hasClientSecret: true } }))
            .toEqual({ tone: "ok", label: "Verbunden", missing: false });
        expect(logic.connectionState("battlenet", { blizzard: { clientId: "" } }).missing).toBe(true);
    });

    it("never counts the Discord connection or unknown token numbers as missing", () => {
        expect(logic.connectionState("discord", { botOnline: false }).missing).toBe(false);
        expect(logic.connectionState("lootsync", { tokenCount: null }).missing).toBe(false);
        expect(logic.connectionState("lootsync", { tokenCount: 0 }).missing).toBe(true);
        expect(logic.connectionState("lootsync", { tokenCount: 2 })).toEqual({ tone: "accent", label: "2 Tokens", missing: false });
    });

    it("sends only its own block from a modal", () => {
        expect(logic.connectionPatch("wcl", { clientId: " id ", model: "ignored" }, undefined))
            .toEqual({ warcraftlogsV2: { clientId: "id" } });
        expect(logic.connectionPatch("anthropic", { model: "claude-opus-5", clientId: "ignored" }, "sk"))
            .toEqual({ anthropic: { model: "claude-opus-5", apiKey: "sk" } });
        expect(logic.connectionPatch("discord", { guildId: "1", raidhelperServerId: "2" }, "never"))
            .toEqual({ guildId: "1", raidhelperServerId: "2" });
    });

    it("keeps the secret contract: undefined keeps, empty clears", () => {
        expect(logic.connectionPatch("battlenet", { clientId: "c", realmSlug: "Thunderstrike" }, undefined)).toEqual({
            blizzard: { clientId: "c", region: "eu", realmSlug: "thunderstrike", namespace: "" },
        });
        expect(logic.connectionPatch("battlenet", {}, "").blizzard.clientSecret).toBe("");
    });
});

describe("category list", () => {
    const categories = [{ id: "c1", name: "Hyjal" }, { id: "c2", name: "Allgemein" }];

    it("keeps configured ids Discord no longer knows, marked unknown", () => {
        expect(logic.categoryRows(categories, ["c1", "gone", "gone"])).toEqual([
            { id: "c1", name: "Hyjal", unknown: false },
            { id: "c2", name: "Allgemein", unknown: false },
            { id: "gone", name: "gone", unknown: true },
        ]);
    });

    it("folds the inactive categories away unless all are asked for, but never an unknown id", () => {
        const rows = logic.categoryRows(categories, ["gone"]);
        const { shown, folded } = logic.splitCategoryRows(rows, ["c1"], false);
        expect(shown.map((r) => r.id)).toEqual(["c1", "gone"]);
        expect(folded.map((r) => r.id)).toEqual(["c2"]);
        expect(logic.splitCategoryRows(rows, ["c1"], true).folded).toEqual([]);
    });
});
