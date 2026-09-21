// Event verwalten (#288) in the raid detail: the rules behind the menu and the
// dialogs (src/web-client/src/lib/eventManage.ts), run for real, and the page's
// structure checked on the source — one menu button, every action a dialog or
// one question, only for an own event with raids write.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

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

/** The lib without its TypeScript: `import type`, `export type` and one-line signatures only. */
function load() {
    const lines = read("lib", "eventManage.ts").split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^import type /.test(line)) continue;
        if (/^export type /.test(line)) {
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
        out.push(line.replace(/^export /, ""));
    }
    const js = out.join("\n");
    const names = [...js.matchAll(/^(?:function|const) (\w+)/gm)].map((m) => m[1]);
    return new Function(`${js}\nreturn { ${names.join(", ")} };`)();
}

const lib = load();
const ids = (menu) => menu.map((e) => (e === "sep" ? "|" : e.id));

describe("the manage menu", () => {
    const base = { cancelled: false, signupsClosed: false, isPast: false, logCount: 0 };

    it("lists every action once, the dangerous one last and apart", () => {
        const menu = lib.manageMenu(base);
        expect(ids(menu)).toEqual(["move", "signups", "raider", "|", "notify", "sheet", "softres", "|", "history", "|", "cancel", "delete"]);
        expect(menu.filter((e) => e !== "sep" && e.danger).map((e) => e.id)).toEqual(["cancel", "delete"]);
        // every entry says what it does
        for (const e of menu.filter((x) => x !== "sep")) expect(e.sub.length).toBeGreaterThan(5);
    });

    it("holds the rare things only: what belongs to a step moved into the step bar (#319)", () => {
        // Bearbeiten, Fehlende pingen and Setup öffnen are a step's one deed now
        for (const state of [base, { ...base, isPast: true }]) {
            expect(ids(lib.manageMenu(state))).not.toContain("edit");
            expect(ids(lib.manageMenu(state))).not.toContain("ping");
            expect(ids(lib.manageMenu(state))).not.toContain("setup");
        }
        // …while the three the old progress bar was the only way to live here now
        expect(ids(lib.manageMenu(base))).toEqual(expect.arrayContaining(["notify", "sheet", "softres"]));
        // a past raid gets no signup call anymore, but keeps sheet and softres
        expect(ids(lib.manageMenu({ ...base, isPast: true }))).not.toContain("notify");
    });

    it("offers the softres list only where the loot system uses one", () => {
        expect(ids(lib.manageMenu({ ...base, softres: false }))).not.toContain("softres");
        expect(ids(lib.manageMenu({ ...base, softres: true }))).toContain("softres");
        // an older payload without a loot system keeps the entry
        expect(ids(lib.manageMenu(base))).toContain("softres");
    });

    it("offers Invite callen with an approved setup — also once the raid started, never when cancelled", () => {
        expect(ids(lib.manageMenu(base))).not.toContain("invite");
        expect(ids(lib.manageMenu({ ...base, invite: true }))).toEqual(["move", "signups", "raider", "|", "invite", "notify", "sheet", "softres", "|", "history", "|", "cancel", "delete"]);
        expect(ids(lib.manageMenu({ ...base, invite: true, isPast: true }))).toContain("invite");
        expect(ids(lib.manageMenu({ ...base, invite: true, cancelled: true }))).not.toContain("invite");
        expect(lib.manageMenu({ ...base, invite: true }).find((e) => e.id === "invite").sub).toContain("/w");
    });

    it("says open or close depending on the state and counts the log", () => {
        expect(lib.manageMenu(base).find((e) => e.id === "signups").label).toBe("Anmeldung schließen");
        expect(lib.manageMenu({ ...base, signupsClosed: true }).find((e) => e.id === "signups").label).toBe("Anmeldung öffnen");
        expect(lib.manageMenu({ ...base, logCount: 3 }).find((e) => e.id === "history").sub).toMatch(/^3 Einträge/);
    });

    it("offers only taking back, the history and deleting for a cancelled event, and nothing time-bound for a past raid", () => {
        expect(ids(lib.manageMenu({ ...base, cancelled: true }))).toEqual(["reopen", "|", "history", "|", "delete"]);
        const past = lib.manageMenu({ ...base, isPast: true });
        expect(ids(past)).toEqual(["raider", "|", "sheet", "softres", "|", "history", "|", "delete"]);
        // a past raid is deleted only with a confirmation, and the entry says what is lost
        expect(past.find((e) => e.id === "delete").sub).toMatch(/Bestätigung.*Anwesenheit/);
    });
});

describe("the dialogs' rules", () => {
    it("reads a start as the Berlin date and time", () => {
        // 2026-09-24 17:30 UTC = 19:30 in Berlin (summer time)
        expect(lib.berlinDateTime(Date.UTC(2026, 8, 24, 17, 30) / 1000)).toEqual({ date: "2026-09-24", time: "19:30" });
        expect(lib.berlinDateTime(0)).toEqual({ date: "", time: "" });
    });

    it("shows what the channel will be called, or why it keeps its name", () => {
        const plan = (channel) => ({ channel: { current: "mi-24-09-ssc-tk", next: "fr-26-09-ssc-tk", rename: true, reason: "", ...channel } });
        expect(lib.moveChannelText(plan({}), true)).toEqual({ value: "#fr-26-09-ssc-tk", sub: "statt #mi-24-09-ssc-tk" });
        expect(lib.moveChannelText(plan({}), false).sub).toMatch(/ausgeschaltet/);
        expect(lib.moveChannelText(plan({ rename: false, next: "mi-24-09-ssc-tk", reason: "Im Kanalnamen ist kein Datum erkennbar — der Name bleibt." }), true))
            .toEqual({ value: "#mi-24-09-ssc-tk", sub: "Im Kanalnamen ist kein Datum erkennbar — der Name bleibt." });
    });

    it("says who hears of a move and what a cancellation does", () => {
        expect(lib.moveNotifyText(22, true)).toBe("Post im Event-Kanal, 22 Angemeldete werden erwähnt.");
        expect(lib.moveNotifyText(22, false)).toMatch(/erfahren es nicht/);
        expect(lib.moveNotifyText(0, true)).toMatch(/Niemand/);
        expect(lib.cancelSummary(18, true, true)).toBe("Nachricht wird als ABGESAGT markiert · DM an 18 Angemeldete · Kanal ins Archiv");
        expect(lib.cancelSummary(18, false, false)).toBe("Nachricht wird als ABGESAGT markiert · keine DM");
        expect(lib.cancelReasonOk("  ")).toBe(false);
        expect(lib.cancelReasonOk("Zu wenig Heiler")).toBe(true);
    });

    it("says what deleting takes along and what stays, and wants a confirmation for a started raid", () => {
        const d = { started: false, cancelled: false, signups: 12, recipients: 10, messages: 2, logs: 0, loot: 0, canNotify: true };
        expect(lib.deleteLines(d)).toEqual({ gone: ["12 Anmeldungen", "Anmelde- und Setup-Nachricht im Kanal"], stays: [] });
        const past = { ...d, started: true, signups: 1, messages: 1, logs: 2, loot: 1, canNotify: false };
        expect(lib.deleteLines(past)).toEqual({ gone: ["1 Anmeldung", "die Anwesenheit dieses Raids", "die Nachricht im Kanal"], stays: ["2 Logs", "1 Loot-Eintrag"] });
        expect(lib.deleteSummary(d, false, false)).toBe("Event wird entfernt · Kanal bleibt");
        expect(lib.deleteSummary(d, true, true)).toBe("Event wird entfernt · DM an 10 Angemeldete · Kanal ins Archiv");
        // no DM where none is offered, even if the switch was left on
        expect(lib.deleteSummary(past, true, false)).toBe("Event wird entfernt · Kanal bleibt");
        expect(lib.deleteReady(null, true)).toBe(false);
        expect(lib.deleteReady(d, false)).toBe(true);
        expect(lib.deleteReady(past, false)).toBe(false);
        expect(lib.deleteReady(past, true)).toBe(true);
    });

    it("finds raiders by Discord name or character and wants raider, character and spec", () => {
        const raiders = [
            { userId: "1", name: "thor", characters: [{ name: "Thorwald" }], signup: null },
            { userId: "2", name: "ysi", characters: [{ name: "Ysolde" }], signup: null },
        ];
        expect(lib.filterRaiders(raiders, "YSO").map((r) => r.userId)).toEqual(["2"]);
        expect(lib.filterRaiders(raiders, "th").map((r) => r.userId)).toEqual(["1"]);
        expect(lib.filterRaiders(raiders, "")).toHaveLength(2);
        expect(lib.raiderInputOk("1", "Thorwald", "Warrior-Protection")).toBe(true);
        expect(lib.raiderInputOk("1", "T", "Warrior-Protection")).toBe(false);
        expect(lib.raiderInputOk("", "Thorwald", "x")).toBe(false);
        expect(lib.orgaStatuses()).toEqual(["signed", "tentative", "late", "bench"]);
        const candidates = { classes: [{ id: "Mage", specs: [{ key: "Mage-Frost" }] }] };
        expect(lib.specsOfClass(candidates, "Mage")).toEqual([{ key: "Mage-Frost" }]);
        expect(lib.specsOfClass(candidates, "")).toEqual([]);
    });
});

describe("the raid detail page", () => {
    const page = read("pages", "RaidDetailPage.tsx");
    const hero = read("pages", "raid-detail", "RaidDetailHero.tsx");
    const roster = read("pages", "raid-detail", "RosterTab.tsx");
    const menu = read("pages", "raid-detail", "manage", "ManageMenu.tsx");

    it("has one Verwalten button in the head, only for an own event with raids write", () => {
        expect(page).toContain("canManage: data.event.source === \"eventhelper\" && canAccess(user, \"raids\", \"write\")");
        expect(page).toContain("manage={canManage ? (");
        expect(hero).toContain("{manage}");
        // the old separate edit icon is gone — editing is the menu's first entry
        expect(hero).not.toContain("aria-label=\"Event bearbeiten\"");
        expect(menu).toContain("manageMenu(state)");
        expect(menu).toContain("aria-haspopup=\"menu\"");
        expect((menu.match(/<Button\b/g) || []).length).toBe(1);
    });

    it("opens a dialog per action, asks once for closing and taking back, and wires the edit dialog", () => {
        for (const modal of ["MoveModal", "CancelModal", "DeleteModal", "RaiderModal", "HistoryModal"]) {
            const src = read("pages", "raid-detail", "manage", `${modal}.tsx`);
            expect({ modal, usesModal: src.includes("<Modal") }).toEqual({ modal, usesModal: true });
            expect(page).toContain(`<${modal} ctx={ctx}`);
        }
        expect(page).toContain("if (action === \"edit\") setEditing(true);");
        expect(page).toMatch(/action === "signups"[\s\S]*await ask\(/);
        expect(page).toMatch(/action === "reopen"[\s\S]*await ask\(/);
    });

    it("previews a move before it happens and shows the channel's new name", () => {
        const move = read("pages", "raid-detail", "manage", "MoveModal.tsx");
        expect(move).toContain("getMovePreview(eventId, date, time)");
        expect(move).toContain("moveChannelText(plan, rename)");
        expect(move).toContain("disabled={!plan || loading}");
        expect(move).toContain("label={t(\"raidManage.move.rename\")}");
        expect(require("./i18nHelper").makeT("de")("raidManage.move.rename")).toBe("Kanal umbenennen");
    });

    it("wants a reason to cancel, says who gets a DM, and offers the archive only when one exists", () => {
        const cancel = read("pages", "raid-detail", "manage", "CancelModal.tsx");
        expect(cancel).toContain("disabled={!info || !cancelReasonOk(reason)}");
        expect(cancel).toContain("hint={cancelSummary(recipients, notify, archive)}");
        expect(cancel).toContain("info && !info.archive.configured");
        expect(cancel).toContain("variant=\"danger\"");
    });

    it("deletes after one dialog: what goes and stays, the started-raid switch, then back to the raid list", () => {
        const del = read("pages", "raid-detail", "manage", "DeleteModal.tsx");
        expect(page).toContain("else if (action === \"delete\") setModal(\"delete\");");
        expect(del).toContain("disabled={!deleteReady(d, confirmed)}");
        expect(del).toContain("deleteLines(d)");
        expect(del).toContain("hint={d ? deleteSummary(d, notify, archive) : undefined}");
        expect(del).toContain("d && d.started && (");
        expect(del).toContain("d && d.canNotify && d.recipients > 0 && (");
        expect(del).toContain("navigate(\"/raids\")");
        // both switches start off
        expect(del).toContain("const [notify, setNotify] = useState(false);");
        expect(del).toContain("const [archive, setArchive] = useState(false);");
    });

    it("marks a cancelled event and a closed signup in the head", () => {
        expect(hero).toContain("abgesagt");
        expect(hero).toContain("Anmeldung geschlossen");
    });

    it("offers Raider eintragen in the roster of an own event", () => {
        expect(roster).toContain("ctx.canManage && data.ownSignups && ev.status !== \"cancelled\"");
        expect(roster).toContain("openModal(\"raider\")");
    });

    it("styles everything in its own stylesheet under em-", () => {
        const css = read("styles", "event-manage.css").replace(/\/\*[\s\S]*?\*\//g, "");
        const classes = [...css.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]).filter((c) => !["btn", "wi", "badge", "danger", "on", "is-loading"].includes(c));
        for (const c of classes) expect({ c, ok: c.startsWith("em-") }).toEqual({ c, ok: true });
        expect(page).toContain("import \"../styles/event-manage.css\";");
    });
});
