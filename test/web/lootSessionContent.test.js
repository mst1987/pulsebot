const { deriveContent, sessionContentLabel } = require("../../src/web/lootSessionContent");

// IDs direkt aus der Tabelle ziehen statt sie hinzuschreiben: erfundene IDs
// prüfen nur, was ich beim Schreiben geglaubt habe. So hängen die Tests an den
// echten Daten und fallen auf, wenn die Tabelle sich ändert.
const { RAID_LOOT, sourceForItem } = require("../../src/config/tbcContent");

function idsFor(content, count) {
    const out = [];
    for (const list of Object.values(RAID_LOOT[content] || {})) {
        for (const id of list) {
            // Nur eindeutige IDs — manche Trash-Items droppen in mehreren Raids.
            if (sourceForItem(id).content === content) out.push(id);
            if (out.length >= count) return out;
        }
    }
    return out;
}

const KARA = idsFor("kara", 4);
const SSC = idsFor("ssc", 4);
const TK = idsFor("tk", 4);
const GRUUL = idsFor("gruul", 1);

const items = (ids) => ids.map((itemId) => ({ itemId }));

it("die Testdaten stammen wirklich aus den erwarteten Raids", () => {
    expect(KARA).toHaveLength(4);
    expect(SSC).toHaveLength(4);
    expect(TK).toHaveLength(4);
    expect(KARA.every((id) => sourceForItem(id).content === "kara")).toBe(true);
    expect(SSC.every((id) => sourceForItem(id).content === "ssc")).toBe(true);
});

describe("web/lootSessionContent", () => {
    describe("deriveContent", () => {
        it("erkennt einen Raid aus den Item-IDs", () => {
            const r = deriveContent(items(SSC));
            expect(r.contentIds).toContain("ssc");
            expect(r.label).toBeTruthy();
            expect(r.matched).toBe(SSC.length);
        });

        // TBC-Abende kombinieren Raids — das ist keine Unsauberkeit, sondern
        // wie gespielt wird.
        it("nennt zwei Raids, wenn beide nennenswert vertreten sind", () => {
            const r = deriveContent(items([...SSC, ...SSC, ...TK, ...TK]));
            expect(r.contentIds.length).toBeGreaterThanOrEqual(2);
            expect(r.label).toContain("+");
        });

        it("lässt Einzelstücke unter der Schwelle weg", () => {
            // 12 SSC gegen 1 aus einem anderen Raid: der eine zählt nicht.
            const r = deriveContent(items([...SSC, ...SSC, ...SSC, ...SSC, GRUUL[0]]));
            expect(r.contentIds[0]).toBe("ssc");
            expect(r.label).not.toContain("+");
        });

        it("liefert nichts Erfundenes, wenn keine ID zuzuordnen ist", () => {
            const r = deriveContent(items([1, 2, 3]));
            expect(r).toMatchObject({ contentIds: [], label: "", matched: 0, total: 3 });
        });

        it("verträgt leere und kaputte Eingaben", () => {
            expect(deriveContent([])).toMatchObject({ label: "", matched: 0 });
            expect(deriveContent(null)).toMatchObject({ label: "", matched: 0, total: 0 });
            expect(deriveContent([null, {}, { itemId: 0 }])).toMatchObject({ label: "", matched: 0 });
        });

        it("zählt, wie viele Items zugeordnet werden konnten", () => {
            const r = deriveContent(items([...SSC, 1, 2]));
            expect(r.matched).toBe(SSC.length);
            expect(r.total).toBe(SSC.length + 2);
        });
    });

    describe("sessionContentLabel", () => {
        it("lässt der Meldung des Addons den Vorrang", () => {
            const r = sessionContentLabel({ instance: "Coilfang: Serpentshrine Cavern", items: items(TK) });
            expect(r).toMatchObject({ label: "Coilfang: Serpentshrine Cavern", source: "addon" });
        });

        it("leitet ab, wenn das Addon nichts gemeldet hat (reiner Gargul-Abend)", () => {
            const r = sessionContentLabel({ instance: "", items: items(SSC) });
            expect(r.source).toBe("items");
            expect(r.label).toBeTruthy();
        });

        // Der eigentliche Anlass: RCLootcouncil schreibt den Kontinent, wenn ein
        // Item ausserhalb der Instanz vergeben wurde — ein Karazhan-Abend hiess
        // dadurch "Eastern Kingdoms".
        it("übergeht einen blossen Kontinent zugunsten der Item-Erkennung", () => {
            const r = sessionContentLabel({ instance: "Eastern Kingdoms", items: items(KARA) });
            expect(r.source).toBe("items");
            expect(r.label).toBe("Karazhan");
        });

        it("erkennt auch Outland als nichtssagend", () => {
            const r = sessionContentLabel({ instance: "Outland", items: items(SSC) });
            expect(r.source).toBe("items");
        });

        // Ein Upload aus einer älteren Addon-Version bringt die Rohform mit;
        // der Server darf sich nicht darauf verlassen, dass schon aufgeräumt
        // wurde, sonst wird ein Kontinent nicht als Kontinent erkannt.
        it("räumt die Rohform aus RCLootcouncil selbst auf", () => {
            expect(sessionContentLabel({ instance: "Eastern Kingdoms-", items: items(KARA) }))
                .toMatchObject({ label: "Karazhan", source: "items" });
            expect(sessionContentLabel({ instance: "Outland-", items: items(SSC) }).source).toBe("items");
            expect(sessionContentLabel({ instance: "Tempest Keep-25 Player", items: items(SSC) }))
                .toMatchObject({ label: "Tempest Keep", source: "addon" });
        });

        it("behält den Kontinent, wenn die Items nichts hergeben", () => {
            const r = sessionContentLabel({ instance: "Eastern Kingdoms", items: items([1, 2]) });
            expect(r).toMatchObject({ label: "Eastern Kingdoms", source: "addon" });
        });

        it("bleibt leer, wenn weder Addon noch Items etwas wissen", () => {
            expect(sessionContentLabel({ instance: "", items: items([1]) })).toMatchObject({ label: "", source: "" });
        });

        it("gibt die Ableitung immer mit zurück, auch wenn das Addon gewinnt", () => {
            const r = sessionContentLabel({ instance: "Tempest Keep", items: items(SSC) });
            expect(r.source).toBe("addon");
            expect(r.derived.matched).toBe(SSC.length);
        });
    });
});
