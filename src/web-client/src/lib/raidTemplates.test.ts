// Raid-Vorlagen (#266): the rules behind the page (lib/raidTemplates.ts), run
// for real against the server's. The page is rendered in
// pages/RaidTemplatesPage.test.tsx (its source rules: test/web-client/conventions/raidTemplates.test.js).
import { describe, expect, it } from "vitest";
import * as mod from "./raidTemplates";
import { requireBackend } from "../test/backend";
import { inLang } from "../test/i18n";

const { publicVersions } = requireBackend("config/gameVersions");
const server = requireBackend("services/events/raidTemplates");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests hand the lib loose fixtures, as the Jest version did
const logic: any = mod;
const versions = publicVersions();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (id: string) => versions.find((x: any) => x.id === id);

describe("Raid-Vorlagen rules (client)", () => {
    it("proposes tanks and healers for a size, like the server", () => {
        const cases = [
            ["tbc", ["kara"], 10], ["tbc", ["gruul", "mag"], 25], ["tbc", ["kara"], 25],
            ["classic", ["ony"], 40], ["classic", [], 20], ["forever", ["forever-hyjal"], 20],
        ];
        for (const [version, ids, size] of cases) {
            expect({ version, ids, size, c: logic.proposeComposition(v(version), ids, size) })
                .toEqual({ version, ids, size, c: server.proposeComposition(version, ids, size) });
        }
    });

    it("offers the allowed sizes of the chosen instances, and none without", () => {
        expect(logic.allowedSizes(v("tbc"), ["kara", "ssc"])).toEqual([10, 25]);
        expect(logic.allowedSizes(v("tbc"), [])).toEqual([]);
    });

    it("counts the places left for DPS", () => {
        expect(logic.dpsSlots(40, 2, 8)).toBe(30);
        expect(logic.dpsSlots(10, 6, 6)).toBe(0);
        expect(logic.dpsSlots(null, 2, 3)).toBe(0);
    });

    it("validates like the server: tanks + healers within the size, sane ranges", () => {
        const draft = (over: Record<string, unknown>) => ({ ...logic.newDraft(v("tbc")), name: "Kara", ...over });
        const bad = [
            draft({ size: 10, composition: { tank: 5, healer: 6, melee: null, ranged: null } }),
            draft({ composition: { tank: 2, healer: 3, melee: { min: 5, max: 2 }, ranged: null } }),
            draft({ size: 10, composition: { tank: 2, healer: 3, melee: { min: 0, max: 12 }, ranged: null } }),
            draft({ size: 10, composition: { tank: 2, healer: 3, melee: { min: 3, max: null }, ranged: { min: 3, max: null } } }),
            draft({ name: " " }),
        ];
        for (const d of bad) {
            const msg = logic.validateDraft(d);
            expect(msg).not.toBe("");
            expect(server.validateTemplate(server.normalizeTemplate(d))).toBe(msg);
        }
        expect(logic.validateDraft(draft({}))).toBe("");
    });

    it("starts a new draft at the first instance's default size with its suggestion", () => {
        expect(logic.newDraft(v("classic"))).toMatchObject({ versionId: "classic", instanceIds: ["ony"], size: 40 });
        const d = logic.newDraft(v("tbc"));
        expect(d.composition).toMatchObject({ tank: 2, healer: 3 });
    });

    it("labels a row with the version and the categories it is the default for", async () => {
        const t = { versionId: "tbc", defaultFor: ["c1", "c2"] };
        expect(logic.templateLabel(t, "TBC", { c1: "Mittwoch-Raid" })).toBe("TBC · Standard für Mittwoch-Raid, c2");
        expect(logic.templateLabel({ versionId: "classic" }, "Classic", {})).toBe("Classic");
        expect(await inLang("en", () => logic.templateLabel(t, "TBC", { c1: "Mittwoch-Raid" }))).toBe("TBC · Default for Mittwoch-Raid, c2");
    });

    it("filters by version, '' being all", () => {
        const list = [{ versionId: "tbc" }, { versionId: "classic" }];
        expect(logic.filterByVersion(list, "")).toHaveLength(2);
        expect(logic.filterByVersion(list, "classic")).toEqual([{ versionId: "classic" }]);
    });

    describe("Aussehen (#307)", () => {
        const look = requireBackend("services/events/embedLook");

        it("beurteilt Farbe und Bild wortgleich mit dem Server", () => {
            for (const color of ["", "#1f8ba5", "#1F8BA5", "1f8ba5", "#abc", "rot", "#12345g"]) {
                expect({ color, msg: logic.colorProblem(color) }).toEqual({ color, msg: look.colorProblem(color) });
            }
            const images = [
                { mode: "thumbnail", url: "" },
                { mode: "banner", url: "https://cdn.example/a.png" },
                { mode: "banner", url: "http://cdn.example/a.png" },
                { mode: "gross", url: "https://cdn.example/a.png" },
                { mode: "thumbnail", url: `https://cdn.example/${"a".repeat(600)}.png` },
            ];
            for (const image of images) {
                expect({ image, msg: logic.imageProblem(image) }).toEqual({ image, msg: look.imageProblem(image) });
            }
            expect(logic.imageProblem(undefined)).toBe("");
            expect(logic.MAX_IMAGE_URL).toBe(look.MAX_URL);
        });

        it("meldet eine kaputte Farbe im Entwurf, wie der Server", () => {
            const draft = { ...logic.newDraft(v("tbc")), name: "Kara", color: "rot" };
            const msg = logic.validateDraft(draft);
            expect(msg).toMatch(/#rrggbb/);
            expect(server.validateTemplate(server.normalizeTemplate(draft), draft)).toBe(msg);
        });

        it("wählt dieselbe führende Instanz wie der Server", () => {
            for (const ids of [["ssc", "tk"], ["tk", "ssc"], ["kara", "gruul"], ["gruul", "kara"], [], ["gibtsnicht"]]) {
                const mine = logic.leadInstance(v("tbc"), ids);
                const theirs = look.leadInstance(ids);
                expect({ ids, id: mine ? mine.id : null }).toEqual({ ids, id: theirs ? theirs.id : null });
            }
        });

        it("kennt die Akzentfarbe des Servers und bekommt jede Instanzfarbe aus der API", () => {
            const { embedAccentColor } = requireBackend("config/variables");
            expect(logic.EMBED_ACCENT).toBe(`#${embedAccentColor.toString(16).padStart(6, "0")}`);
            for (const version of versions) {
                for (const inst of version.instances) expect(`${inst.id}: ${inst.color}`).toMatch(/: #[0-9a-f]{6}$/);
            }
        });

        it("nimmt Farbe und Bild in einen neuen und einen geladenen Entwurf auf", () => {
            expect(logic.newDraft(v("tbc"))).toMatchObject({ color: "", image: { mode: "thumbnail", url: "" } });
            expect(logic.draftOf({
                id: "t1", name: "x", versionId: "tbc", instanceIds: [], size: 25,
                composition: { tank: 0, healer: 0 }, color: "#ff8800", image: { mode: "banner", url: "https://cdn.example/a.png" },
            })).toMatchObject({ color: "#ff8800", image: { mode: "banner", url: "https://cdn.example/a.png" } });
            // eine Vorlage von vor #307 hat die Felder nicht
            expect(logic.draftOf({ id: "t1", name: "x", versionId: "tbc", instanceIds: [], size: 25, composition: { tank: 0, healer: 0 } }))
                .toMatchObject({ color: "", image: { mode: "thumbnail", url: "" } });
        });
    });
});
