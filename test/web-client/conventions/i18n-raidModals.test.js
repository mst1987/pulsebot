// The raid-detail dialogs (modals/*, manage/*Modal) and the item search picker
// speak German and English (#i18n): their texts live in the raidModals and
// raidManage namespaces, none is computed at module load (#435: the source half
// of the former test/web-client/i18n-raidModals.test.js; the texts are tested
// in src/web-client/src/i18n/raidModals.test.ts, the call-template sentence in
// pages/raid-detail/modals/NotifyModal.test.tsx).
const { read } = require("../clientSource");

const MODALS = ["LogAssignModal", "LootAddModal", "LootSystemModal", "NotifyModal", "PingModal", "PlayerModal", "SheetModal", "SoftresModal", "TargetField"]
    .map((m) => `pages/raid-detail/modals/${m}.tsx`);
const MANAGE = ["CancelModal", "DeleteModal", "HistoryModal", "MoveModal", "RaiderModal"]
    .map((m) => `pages/raid-detail/manage/${m}.tsx`);
const FILES = [...MODALS, ...MANAGE, "components/loot/ItemSearchPicker.tsx"];

describe("raid-detail dialogs in two languages", () => {
    it("every dialog takes its texts from useT", () => {
        for (const file of FILES) {
            const src = read(file);
            expect({ file, useT: /import \{[^}]*\buseT\b[^}]*\} from "(\.\.\/)+i18n";/.test(src) }).toEqual({ file, useT: true });
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
});
