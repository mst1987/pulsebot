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

    it("names a changed loot system, and treats a missing one as automatisch", () => {
        const draft = base();
        draft.categoryLootSystem = { c1: "lootcouncil", c2: "" };
        expect(logic.draftChanges(base(), draft, names)).toEqual(["Hyjal & BT · Lootsystem → Loot-Council"]);
        const saved = { ...base(), categoryLootSystem: { c1: "gdkp" } };
        expect(logic.draftChanges(saved, { ...base(), categoryLootSystem: { c1: "" } }, names)).toEqual(["Hyjal & BT · Lootsystem → automatisch"]);
    });

    it("names a switched event source, and treats a missing one as Raid-Helper", () => {
        const draft = base();
        draft.categorySignupSource = { c1: "eventhelper", c2: "raidhelper" };
        expect(logic.draftChanges(base(), draft, names)).toEqual(["Hyjal & BT · Neue Events → EventHelper"]);
    });

    it("names the setup DM switch, and treats a missing one as off (#290)", () => {
        const draft = base();
        draft.categorySetupDms = { c1: true, c2: false };
        expect(logic.draftChanges(base(), draft, names)).toEqual(["Hyjal & BT · Setup-DMs an"]);
        const saved = { ...base(), categorySetupDms: { c1: true } };
        expect(logic.draftChanges(saved, { ...base(), categorySetupDms: { c1: false } }, names)).toEqual(["Hyjal & BT · Setup-DMs aus"]);
    });

    it("names the Discord-Event switch and the voice channel per category (#305)", () => {
        const draft = base();
        draft.categoryDiscordEvent = { c1: true, c2: false };
        draft.categoryVoiceChannel = { c1: "123456789012345678" };
        expect(logic.draftChanges(base(), draft, names)).toEqual([
            "Hyjal & BT · Discord-Event an",
            "Hyjal & BT · Sprachkanal gesetzt",
        ]);
        const saved = { ...base(), categoryDiscordEvent: { c1: true }, categoryVoiceChannel: { c1: "123456789012345678" } };
        expect(logic.draftChanges(saved, { ...base(), categoryDiscordEvent: { c1: false }, categoryVoiceChannel: { c1: "" } }, names)).toEqual([
            "Hyjal & BT · Discord-Event aus",
            "Hyjal & BT · Sprachkanal entfernt",
        ]);
    });

    it("names the create announcement and its target, missing = off (#306)", () => {
        const draft = base();
        draft.categoryAnnounce = { c1: { enabled: true, target: "both" } };
        expect(logic.draftChanges(base(), draft, names)).toEqual(["Hyjal & BT · Ankündigung → beide Server"]);
        const saved = { ...base(), categoryAnnounce: { c1: { enabled: true, target: "event" } } };
        expect(logic.draftChanges(saved, { ...base(), categoryAnnounce: { c1: { enabled: false, target: "event" } } }, names))
            .toEqual(["Hyjal & BT · Ankündigung → aus"]);
        expect(logic.announceMode(undefined)).toBe("");
        expect(logic.announceMode({ enabled: true, target: "" })).toBe("event");
    });

    it("names the message mode with Vielleicht/Absage, missing = optional", () => {
        expect(logic.draftChanges(base(), { ...base(), categorySignupNotes: { c1: "optional" } }, names)).toEqual([]);
        expect(logic.draftChanges(base(), { ...base(), categorySignupNotes: { c1: "required" } }, names))
            .toEqual(["Hyjal & BT · Nachricht bei Vielleicht/Absage → Pflicht"]);
        expect(logic.draftChanges({ ...base(), categorySignupNotes: { c1: "none" } }, { ...base(), categorySignupNotes: { c1: "optional" } }, names))
            .toEqual(["Hyjal & BT · Nachricht bei Vielleicht/Absage → optional"]);
        expect(logic.signupNoteMode(undefined, "c1")).toBe("optional");
        expect(logic.signupNoteMode({ c1: "odd" }, "c1")).toBe("optional");
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
        // The server itself moved to Discord-Server (#251): the card no longer sends guildId.
        expect(logic.connectionPatch("discord", { guildId: "1", raidhelperServerId: "2" }, "never"))
            .toEqual({ raidhelperServerId: "2" });
    });

    it("keeps the secret contract: undefined keeps, empty clears", () => {
        expect(logic.connectionPatch("battlenet", { clientId: "c", realmSlug: "Thunderstrike" }, undefined)).toEqual({
            blizzard: { clientId: "c", region: "eu", realmSlug: "thunderstrike", namespace: "" },
        });
        expect(logic.connectionPatch("battlenet", {}, "").blizzard.clientSecret).toBe("");
    });
});

describe("Discord-Server cards (#251)", () => {
    const card = (over = {}) => ({ connected: true, permissions: [{ label: "Rollen verwalten", ok: true }], missing: [], ...over });

    it("says what a server card needs, without counting unknown rights", () => {
        expect(logic.serverCardState(null, false)).toEqual({ tone: "mid", label: "Kein Server gewählt", missing: true });
        expect(logic.serverCardState(null, true)).toEqual({ tone: "", label: "Kein zweiter Server", missing: false });
        expect(logic.serverCardState(card({ connected: false }), true).label).toBe("Bot nicht auf dem Server");
        expect(logic.serverCardState(card({ permissions: null }), false)).toEqual({ tone: "", label: "Rechte unbekannt", missing: false });
        expect(logic.serverCardState(card({ missing: ["Rollen verwalten"] }), false).label).toBe("1 Recht fehlt");
        expect(logic.serverCardState(card({ missing: ["a", "b"] }), false).label).toBe("2 Rechte fehlen");
        expect(logic.serverCardState(card(), false)).toEqual({ tone: "ok", label: "Verbunden", missing: false });
    });

    it("counts the cards that need attention for the sidebar badge", () => {
        expect(logic.serverIssues(null)).toBe(0);
        expect(logic.serverIssues({ event: card(), talk: null })).toBe(0);
        expect(logic.serverIssues({ event: card({ missing: ["x"] }), talk: card({ connected: false }) })).toBe(2);
    });

    it("clears a talk server equal to the event server, and its channels without one — never the note channel", () => {
        expect(logic.discordServersPatch({ eventGuildId: " 1 ", talkGuildId: "1", talkOverviewChannelId: "5", talkPingChannelId: "6", signupNoteChannelId: " 7 " }))
            .toEqual({ discordServers: { eventGuildId: "1", talkGuildId: "", talkOverviewChannelId: "", talkPingChannelId: "", signupNoteChannelId: "7" } });
        expect(logic.discordServersPatch({ eventGuildId: "1", talkGuildId: "2", talkOverviewChannelId: "5", talkPingChannelId: "", signupNoteChannelId: "" }))
            .toEqual({ discordServers: { eventGuildId: "1", talkGuildId: "2", talkOverviewChannelId: "5", talkPingChannelId: "", signupNoteChannelId: "" } });
    });

    it("words the member overlap and flags a large gap", () => {
        expect(logic.overlapBadge(null)).toBeNull();
        expect(logic.overlapBadge({ eventCount: 212, talkCount: 208, both: 198, error: null })).toMatchObject({ label: "198 von 212", tone: "ok" });
        expect(logic.overlapBadge({ eventCount: 100, talkCount: 50, both: 50, error: null }).tone).toBe("mid");
        expect(logic.overlapBadge({ eventCount: null, talkCount: null, both: null, error: "Intent fehlt" }))
            .toEqual({ label: "Überschneidung unbekannt", tone: "", tip: "Intent fehlt" });
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

// Pings, reminders and role sync across both servers (#264).
describe("ping targets, role sync and reminders", () => {
    it("offers no Wohin segment without a talk ping channel", () => {
        expect(logic.pingTargetOptions(null)).toEqual([]);
        expect(logic.pingTargetOptions({ talk: false })).toEqual([]);
        const options = logic.pingTargetOptions({ talk: true, talkGuildName: "Pulse Talk", talkChannelName: "pings" });
        expect(options.map((o) => o.value)).toEqual(["event", "talk", "both"]);
        expect(options[1].tip).toContain("#pings auf Pulse Talk");
        expect(options[1].tip).toContain("DM");
    });

    it("says in the modal head where the ping goes", () => {
        const info = { talk: true, talkGuildName: "Pulse Talk", talkChannelName: "pings" };
        expect(logic.targetHint("event", "kara-mi", info)).toBe("in #kara-mi");
        expect(logic.targetHint("talk", "kara-mi", info)).toBe("in #pings");
        expect(logic.targetHint("both", "kara-mi", info)).toBe("in #kara-mi + #pings");
        expect(logic.targetHint("event", "", undefined)).toBeUndefined();
    });

    it("sends only complete role pairs, once per pair", () => {
        expect(logic.roleSyncPatch([
            { eventRoleId: " 1 ", talkRoleId: "2", direction: "both" },
            { eventRoleId: "1", talkRoleId: "2", direction: "toEvent" },
            { eventRoleId: "3", talkRoleId: "", direction: "toTalk" },
        ])).toEqual({ roleSync: [{ eventRoleId: "1", talkRoleId: "2", direction: "both" }] });
    });

    it("replaces an edited pair in place and appends a new one", () => {
        const rules = [{ eventRoleId: "1", talkRoleId: "2", direction: "toTalk" }];
        const changed = { eventRoleId: "1", talkRoleId: "9", direction: "both" };
        expect(logic.withRoleRule(rules, 0, changed)).toEqual([changed]);
        expect(logic.withRoleRule(rules, -1, changed)).toEqual([rules[0], changed]);
        expect(rules[0].talkRoleId).toBe("2");
    });

    it("badges the drift: nothing, a count, or unknown", () => {
        expect(logic.driftBadge(0, null)).toMatchObject({ tone: "ok", label: "Keine Abweichung" });
        expect(logic.driftBadge(3, null)).toMatchObject({ tone: "mid", label: "3 Abweichungen" });
        expect(logic.driftBadge(1, null).label).toBe("1 Abweichung");
        expect(logic.driftBadge(0, "Intent fehlt")).toMatchObject({ tone: "", tip: "Intent fehlt" });
    });

    it("sums a reminder rule up in one short line", () => {
        expect(logic.reminderSummary(undefined)).toBe("aus");
        expect(logic.reminderSummary({ missingHours: 24, signedHours: 1, target: "talk" })).toBe("24 h vor Schluss · 1 h vor Raid");
        expect(logic.reminderSummary({ missingHours: 0, signedHours: 2, target: "event" })).toBe("2 h vor Raid");
    });

    it("sets one category's reminders and removes a switched-off one", () => {
        const current = { a: { missingHours: 24, signedHours: 0, target: "event" } };
        expect(logic.remindersPatch(current, "b", { missingHours: "12", signedHours: 999, target: "both" })).toEqual({
            categoryReminders: { a: current.a, b: { missingHours: 12, signedHours: 168, target: "both" } },
        });
        expect(logic.remindersPatch(current, "a", { missingHours: 0, signedHours: -1, target: "event" })).toEqual({ categoryReminders: {} });
        expect(current.a.missingHours).toBe(24);
    });
});

describe("raid overview on the talk server (#257)", () => {
    const NOW = 10_000_000;
    const base = { configured: true, channelId: "ov", messageId: "m1", messageUrl: "u", postedAt: 0, editedAt: 0, checkedAt: 0, error: "" };

    it("says how long ago, short", () => {
        expect(logic.agoText(0, NOW)).toBe("");
        expect(logic.agoText(NOW - 10_000, NOW)).toBe("gerade eben");
        expect(logic.agoText(NOW - 5 * 60000, NOW)).toBe("vor 5 Min.");
        expect(logic.agoText(NOW - 3 * 3600000, NOW)).toBe("vor 3 Std.");
    });

    it("shows one badge with the times in the tooltip", () => {
        expect(logic.talkOverviewBadge(null, NOW)).toMatchObject({ label: "nicht eingestellt", tone: "" });
        expect(logic.talkOverviewBadge({ ...base, messageId: "" }, NOW)).toMatchObject({ label: "noch nicht gepostet", tone: "" });
        const posted = logic.talkOverviewBadge({ ...base, postedAt: NOW - 120000, checkedAt: NOW - 60000 }, NOW);
        expect(posted).toMatchObject({ label: "gepostet vor 2 Min.", tone: "ok" });
        expect(posted.tipSub).toContain("Zuletzt geprüft vor 1 Min.");
        expect(logic.talkOverviewBadge({ ...base, postedAt: NOW - 7200000, editedAt: NOW - 60000 }, NOW).label).toBe("bearbeitet vor 1 Min.");
        const failed = logic.talkOverviewBadge({ ...base, error: "Bot nicht verbunden." }, NOW);
        expect(failed).toMatchObject({ label: "Fehler", tone: "mid" });
        expect(failed.tipSub).toContain("Bot nicht verbunden.");
    });
});
