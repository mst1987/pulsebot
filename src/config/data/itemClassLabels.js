// German labels of WoW's item classes and subclasses (TBC ids, as Wowhead's
// item XML gives them in `<class id>` / `<subclass id>`). The guild bank lists
// its items in groups named after these (services/guildbank/stockView.js
// itemGroup): item names come from Wowhead in English, the rest of the page and
// the Discord texts stay German, so the group labels are mapped here from the
// ids instead of taken from Wowhead's (English) text. An id missing here falls
// back to Wowhead's English text.
//
// Plural where the label names a group of items ("Tränke", "Edelsteine"),
// following Wowhead's German site.
const ITEM_CLASSES = {
    0: {
        label: "Verbrauchbar",
        sub: {
            0: "Verbrauchbar", 1: "Tränke", 2: "Elixiere", 3: "Fläschchen", 4: "Rollen",
            5: "Speis & Trank", 6: "Gegenstandsverbesserungen", 7: "Verbände", 8: "Sonstiges",
        },
    },
    1: {
        label: "Behälter",
        sub: {
            0: "Taschen", 1: "Seelentaschen", 2: "Kräutertaschen", 3: "Verzauberertaschen",
            4: "Ingenieurstaschen", 5: "Edelsteintaschen", 6: "Bergbautaschen", 7: "Lederertaschen",
        },
    },
    2: {
        label: "Waffe",
        sub: {
            0: "Einhandäxte", 1: "Zweihandäxte", 2: "Bögen", 3: "Schusswaffen", 4: "Einhandstreitkolben",
            5: "Zweihandstreitkolben", 6: "Stangenwaffen", 7: "Einhandschwerter", 8: "Zweihandschwerter",
            10: "Stäbe", 13: "Faustwaffen", 14: "Verschiedenes", 15: "Dolche", 16: "Wurfwaffen",
            18: "Armbrüste", 19: "Zauberstäbe", 20: "Angelruten",
        },
    },
    3: {
        label: "Edelsteine",
        sub: {
            0: "Rote Edelsteine", 1: "Blaue Edelsteine", 2: "Gelbe Edelsteine", 3: "Violette Edelsteine",
            4: "Grüne Edelsteine", 5: "Orange Edelsteine", 6: "Meta-Edelsteine", 7: "Einfache Edelsteine",
            8: "Prismatische Edelsteine",
        },
    },
    4: {
        label: "Rüstung",
        sub: {
            0: "Verschiedenes", 1: "Stoff", 2: "Leder", 3: "Schwere Rüstung", 4: "Platte",
            6: "Schilde", 7: "Buchbände", 8: "Götzen", 9: "Totems",
        },
    },
    5: { label: "Reagenzien", sub: { 0: "Reagenzien" } },
    6: { label: "Projektile", sub: { 2: "Pfeile", 3: "Kugeln" } },
    7: {
        label: "Handwerkswaren",
        sub: {
            0: "Handwerkswaren", 1: "Teile", 2: "Sprengstoffe", 3: "Geräte", 4: "Juwelenschleifen",
            5: "Stoff", 6: "Leder", 7: "Metall & Stein", 8: "Fleisch", 9: "Kräuter", 10: "Elementar",
            11: "Sonstiges", 12: "Verzauberkunst", 13: "Materialien",
        },
    },
    9: {
        label: "Rezepte",
        sub: {
            0: "Bücher", 1: "Lederverarbeitung", 2: "Schneiderei", 3: "Ingenieurskunst", 4: "Schmiedekunst",
            5: "Kochkunst", 6: "Alchemie", 7: "Erste Hilfe", 8: "Verzauberkunst", 9: "Angeln", 10: "Juwelenschleifen",
        },
    },
    11: { label: "Köcher", sub: { 2: "Köcher", 3: "Munitionsbeutel" } },
    12: { label: "Quest", sub: { 0: "Quest" } },
    13: { label: "Schlüssel", sub: { 0: "Schlüssel", 1: "Dietriche" } },
    15: {
        label: "Verschiedenes",
        sub: { 0: "Plunder", 1: "Reagenzien", 2: "Haustiere", 3: "Feiertag", 4: "Sonstiges", 5: "Reittiere" },
    },
};

const known = (id) => id !== null && id !== undefined && id !== "" && Number.isInteger(Number(id));

/** The German label of an item class, "" for an unknown id. */
function classLabel(classId) {
    if (!known(classId)) return "";
    const entry = ITEM_CLASSES[Number(classId)];
    return entry ? entry.label : "";
}

/** The German label of a subclass of an item class, "" for an unknown pair. */
function subclassLabel(classId, subclassId) {
    if (!known(classId) || !known(subclassId)) return "";
    const entry = ITEM_CLASSES[Number(classId)];
    return (entry && entry.sub[Number(subclassId)]) || "";
}

module.exports = { ITEM_CLASSES, classLabel, subclassLabel };
