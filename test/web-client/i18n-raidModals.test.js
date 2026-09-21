// The raid-detail dialogs (modals/*, manage/*Modal) and the item search picker
// speak German and English (#i18n): their texts live in the raidModals and
// raidManage namespaces, none is computed at module load.
const fs = require("fs");
const path = require("path");
const { makeT } = require("./i18nHelper");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (rel) => fs.readFileSync(path.join(CLIENT, rel), "utf8").replace(/\r\n/g, "\n");

const MODALS = ["LogAssignModal", "LootAddModal", "LootSystemModal", "NotifyModal", "PingModal", "PlayerModal", "SheetModal", "SoftresModal", "TargetField"]
    .map((m) => `pages/raid-detail/modals/${m}.tsx`);
const MANAGE = ["CancelModal", "DeleteModal", "HistoryModal", "MoveModal", "RaiderModal"]
    .map((m) => `pages/raid-detail/manage/${m}.tsx`);
const FILES = [...MODALS, ...MANAGE, "components/ItemSearchPicker.tsx"];

describe("raid-detail dialogs in two languages", () => {
    it("every dialog takes its texts from useT", () => {
        for (const file of FILES) {
            const src = read(file);
            expect({ file, useT: /import \{[^}]*\buseT\b[^}]*\} from "\.\.\/(\.\.\/\.\.\/)?i18n";/.test(src) }).toEqual({ file, useT: true });
            expect({ file, hook: src.includes("const t = useT();") }).toEqual({ file, hook: true });
        }
    });

    it("keeps the moved German literals out of the sources", () => {
        const all = FILES.map(read).join("\n").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
        for (const literal of [
            "\"Log zuordnen\"", "\"Loot hinzufügen\"", "Lootsystem dieses Raids", "Aufruf posten", "Raider pingen",
            "Charakterseite", "Kopie füllen", "Softres pro Spieler", "Event absagen", "Kanal umbenennen",
            "Raider werden geladen", "Item-Namen suchen", "\"Wohin\"", "vor ${days} Tagen",
        ]) {
            expect({ literal, found: all.includes(literal) }).toEqual({ literal, found: false });
        }
    });

    it("calls t only at render time, never at module top level", () => {
        for (const file of FILES) {
            const top = read(file).split("\n").filter((l) => /^(export )?const \w+[^=]*= [^(]*\bt\(/.test(l));
            expect({ file, top }).toEqual({ file, top: [] });
        }
    });

    it("reads the same in German as before and naturally in English", () => {
        const de = makeT("de");
        const en = makeT("en");
        expect(de("raidModals.logAssign.hint", { count: 1 })).toBe("1 Log ohne Event");
        expect(de("raidModals.logAssign.hint", { count: 3 })).toBe("3 Logs ohne Event");
        expect(en("raidModals.logAssign.hint", { count: 3 })).toBe("3 logs without event");
        expect(de("raidModals.lootAdd.added", { item: "Schwert", character: "Ahri" })).toBe("„Schwert“ für Ahri nachgetragen.");
        expect(en("raidModals.ping.submit", { count: 1 })).toBe("Ping 1 raider");
        expect(en("raidModals.ping.submit", { count: 4 })).toBe("Ping 4 raiders");
        expect(de("raidModals.softres.instances", { count: 2 })).toBe("2 Instanzen");
        expect(en("raidModals.softres.instances", { count: 1 })).toBe("1 instance");
        expect(en("raidManage.cancel.title")).toBe("Cancel event");
        expect(de("raidManage.move.renameTip", { current: "a", next: "b" })).toBe("#a → #b. Nur Datum und Wochentag im Namen werden ersetzt.");
        expect(en("raidManage.raider.characters", { count: 2 })).toBe("2 characters");
        expect(en("raidModals.itemSearch.placeholder")).toBe("Search item names (Wowhead) …");
    });

    it("keeps the call-template link sentence whole in German", () => {
        const de = makeT("de");
        const src = read("pages/raid-detail/modals/NotifyModal.tsx");
        expect(src).toContain("{t(\"raidModals.notify.noTemplatesBefore\")} <Link");
        expect(`${de("raidModals.notify.noTemplatesBefore")} ${de("raidModals.notify.noTemplatesLink")}${de("raidModals.notify.noTemplatesAfter")}`)
            .toBe("Noch keine Aufruf-Vorlagen. Lege zuerst unter Aufruf-Vorlagen eine an.");
    });
});
