// Farbe und Bild der Bot-Nachrichten (#307): Validierung von Hex-Farbe und
// Bild-Adresse, der Regelsatz-Fallback (Farbe + Boss-Icon der führenden
// Instanz) und die Regel, dass eine kaputte Adresse die Nachricht nie
// verhindert.
jest.mock("../../../src/config/variables", () => ({ embedAccentColor: 7 }));

const {
    normalizeColor, colorProblem, colorValue, usableUrl, normalizeImage, imageProblem, normalizeLook,
    leadInstance, ruleSetLook, lookOf, embedColor, embedImageFields, MAX_URL,
    raidArtUrl, normalizeCategoryMessageLook, messageLookOf,
} = require("../../../src/services/events/embedLook");

describe("Aussehen der Anmelde-Nachricht je Kategorie", () => {
    it("hat Raid-Bild an und große Titel als Standard", () => {
        expect(messageLookOf({}, "c1")).toEqual({ raidArt: true, titleSize: "large" });
        expect(messageLookOf(undefined, "")).toEqual({ raidArt: true, titleSize: "large" });
        expect(messageLookOf({ categoryMessageLook: { c1: { raidArt: false, titleSize: "huge" } } }, "c1")).toEqual({ raidArt: false, titleSize: "huge" });
    });

    it("speichert nur, was vom Standard abweicht", () => {
        expect(normalizeCategoryMessageLook({
            c1: { raidArt: true, titleSize: "large" },
            c2: { raidArt: false, titleSize: "gigantisch" },
            c3: { titleSize: "normal" },
            " ": { raidArt: false },
        })).toEqual({ c2: { raidArt: false }, c3: { titleSize: "normal" } });
        expect(normalizeCategoryMessageLook(null)).toEqual({});
    });
});
const { instanceById } = require("../../../src/config/gameVersions");

describe("services/events/embedLook", () => {
    describe("Farbe", () => {
        it("nimmt #rrggbb, mit und ohne Raute, in Kleinschreibung", () => {
            expect(normalizeColor("#1F8BA5")).toBe("#1f8ba5");
            expect(normalizeColor(" 1f8ba5 ")).toBe("#1f8ba5");
            expect(colorProblem("#1F8BA5")).toBe("");
        });

        it("weist alles andere mit einem Satz ab, leer ist erlaubt", () => {
            for (const bad of ["#abc", "rot", "#12345g", "#1f8ba55", 12]) {
                expect(normalizeColor(bad)).toBe("");
                expect(colorProblem(bad)).toMatch(/#rrggbb/);
            }
            expect(colorProblem("")).toBe("");
            expect(colorProblem(null)).toBe("");
            expect(colorProblem(undefined)).toBe("");
        });

        it("rechnet in Discords Zahl um", () => {
            expect(colorValue("#ff0000")).toBe(0xff0000);
            expect(colorValue("")).toBeNull();
        });
    });

    describe("Bild", () => {
        it("lässt nur https durch", () => {
            expect(usableUrl("https://cdn.example/a.png")).toBe(true);
            for (const bad of ["http://cdn.example/a.png", "data:image/png;base64,xx", "attachment://a.png", "cdn.example/a.png", ""]) {
                expect(usableUrl(bad)).toBe(false);
            }
        });

        it("begrenzt die Länge", () => {
            const long = `https://cdn.example/${"a".repeat(MAX_URL)}.png`;
            expect(usableUrl(long)).toBe(false);
            expect(imageProblem({ url: long })).toMatch(/höchstens/);
        });

        it("normalisiert Modus und Adresse", () => {
            expect(normalizeImage({ mode: "banner", url: " https://cdn.example/a.png " })).toEqual({ mode: "banner", url: "https://cdn.example/a.png" });
            // ein unbekannter Modus wird zum Thumbnail, eine unbrauchbare Adresse fällt weg
            expect(normalizeImage({ mode: "gross", url: "http://x/y.png" })).toEqual({ mode: "thumbnail", url: "" });
            expect(normalizeImage(null)).toEqual({ mode: "thumbnail", url: "" });
        });

        it("meldet den Fehler als deutschen Satz", () => {
            expect(imageProblem({ url: "http://x/y.png" })).toMatch(/https:\/\//);
            expect(imageProblem({ mode: "gross", url: "" })).toMatch(/thumbnail/);
            expect(imageProblem({ url: "" })).toBe("");
            expect(imageProblem(undefined)).toBe("");
        });
    });

    describe("normalizeLook", () => {
        it("gibt beide Felder zurück", () => {
            expect(normalizeLook({ color: "1f8ba5", image: { mode: "banner", url: "https://cdn.example/a.png" } }).value)
                .toEqual({ color: "#1f8ba5", image: { mode: "banner", url: "https://cdn.example/a.png" } });
        });

        it("bricht bei einer ungültigen Farbe oder Adresse ab", () => {
            expect(normalizeLook({ color: "rot" }).error).toMatch(/#rrggbb/);
            expect(normalizeLook({ image: { url: "ftp://x/y.png" } }).error).toMatch(/https/);
        });
    });

    describe("Regelsatz-Fallback", () => {
        it("nimmt die größte Instanz des Abends, bei Gleichstand die zuerst genannte", () => {
            expect(leadInstance(["ssc", "tk"]).id).toBe("ssc");
            expect(leadInstance(["tk", "ssc"]).id).toBe("tk");
            // Kara (10) neben Gruul (25): Gruul führt, egal wie herum
            expect(leadInstance(["kara", "gruul"]).id).toBe("gruul");
            expect(leadInstance(["gruul", "kara"]).id).toBe("gruul");
            expect(leadInstance(["gibtsnicht"])).toBeNull();
            expect(leadInstance([])).toBeNull();
        });

        it("liefert Farbe und Boss-Icon als https-Thumbnail", () => {
            const look = ruleSetLook(["bt"]);
            expect(look.color).toBe(instanceById("bt").color);
            expect(look.thumbnail).toBe("https://wow.zamimg.com/images/wow/icons/large/achievement_boss_illidan.jpg");
            expect(usableUrl(look.thumbnail)).toBe(true);
        });

        it("liefert das Raid-Bild (Blizzards Zonenbild) der führenden Instanz", () => {
            expect(ruleSetLook(["bt"]).art).toBe("https://render.worldofwarcraft.com/eu/zones/black-temple-small.jpg");
            expect(ruleSetLook(["ssc", "tk"]).art).toContain("serpentshrine-cavern");
            expect(ruleSetLook([]).art).toBe("");
            expect(raidArtUrl("")).toBe("");
            expect(raidArtUrl("../x")).toBe("");
        });

        it("jede TBC- und Classic-Instanz hat ein Raid-Bild", () => {
            const { rulesFor } = require("../../../src/config/gameVersions");
            for (const version of ["tbc", "classic"]) {
                for (const inst of rulesFor(version).instances) expect({ id: inst.id, art: usableUrl(raidArtUrl(inst.art)) }).toEqual({ id: inst.id, art: true });
            }
        });

        it("kodiert einen Apostrophen im Icon-Namen", () => {
            // "achievement_boss_kael'thassunstrider_01" — roh wäre die Adresse für Discord nicht sicher
            expect(ruleSetLook(["tk"]).thumbnail).toContain("kael%27thassunstrider");
        });

        it("jede Instanz jeder Spielversion hat eine Farbe", () => {
            const { VERSIONS } = require("../../../src/config/gameVersions");
            for (const v of VERSIONS) {
                for (const i of v.instances) {
                    expect(`${v.id}/${i.id}: ${i.color}`).toMatch(/: #[0-9a-f]{6}$/);
                }
            }
        });
    });

    describe("lookOf", () => {
        it("ohne eigene Werte: nur die Farbe des Regelsatzes, kein automatisches Bild (#353)", () => {
            const look = lookOf({ id: "eh-1", instanceIds: ["ssc", "tk"] });
            expect(look.color).toBe(colorValue(instanceById("ssc").color));
            expect(look.colorSource).toBe("ruleset");
            expect(look.url).toBe("");
            expect(look.imageSource).toBe("default");
        });

        it("ohne Instanzen: die Akzentfarbe und kein Bild", () => {
            expect(lookOf({ id: "eh-1", instanceIds: [] })).toEqual({
                color: 7, colorSource: "default", mode: "thumbnail", url: "", imageSource: "default",
            });
        });

        it("eigene Werte gewinnen, jedes für sich", () => {
            const both = lookOf({ id: "eh-1", instanceIds: ["ssc"], color: "#ff0000", image: { mode: "banner", url: "https://cdn.example/a.png" } });
            expect(both).toEqual({ color: 0xff0000, colorSource: "event", mode: "banner", url: "https://cdn.example/a.png", imageSource: "event" });
            // nur eine eigene Farbe: kein Bild, ohne eigenes gibt es keins mehr
            const colorOnly = lookOf({ id: "eh-1", instanceIds: ["ssc"], color: "#ff0000" });
            expect(colorOnly.color).toBe(0xff0000);
            expect(colorOnly.imageSource).toBe("default");
            // nur ein eigenes Bild: die Farbe bleibt die der Instanz
            const imageOnly = lookOf({ id: "eh-1", instanceIds: ["ssc"], image: { mode: "banner", url: "https://cdn.example/a.png" } });
            expect(imageOnly.colorSource).toBe("ruleset");
            expect(imageOnly.url).toBe("https://cdn.example/a.png");
        });

        it("eine unbrauchbare Adresse wird weggelassen und geloggt, nie geworfen", () => {
            const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
            const look = lookOf({ id: "eh-9", instanceIds: ["bt"], image: { mode: "banner", url: "http://x/y.png" } });
            expect(look.url).toBe("");
            expect(look.imageSource).toBe("default");
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("eh-9"));
            warn.mockRestore();
        });

        it("verträgt ein Event ohne alles", () => {
            expect(lookOf(null).color).toBe(7);
            expect(lookOf({}).url).toBe("");
        });
    });

    describe("embedColor / embedImageFields", () => {
        it("gibt die Felder so, wie Discord sie will", () => {
            expect(embedColor({ instanceIds: ["hyjal"] })).toBe(colorValue(instanceById("hyjal").color));
            expect(embedImageFields({ instanceIds: ["hyjal"] })).toEqual({});
            expect(embedImageFields({ instanceIds: [], image: { mode: "banner", url: "https://cdn.example/a.png" } }))
                .toEqual({ image: { url: "https://cdn.example/a.png" } });
            expect(embedImageFields({ instanceIds: [] })).toEqual({});
        });
    });
});
