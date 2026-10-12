// The guild bank's waiting list (#775): the pure allocation (strict order,
// parts, nothing twice), the move-up against the stock with the open requests
// taken off, and the orga's import from a pasted sheet (tab, ; or ,, names
// without case and accents, unknown items). Real stores on temp files.
const store = require("../../../src/stores/guildBankStore");
const stockStore = require("../../../src/stores/guildBankStockStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const waitlist = require("../../../src/services/guildbank/waitlist");
const { parseGuildBankScan, GB_FORMAT } = require("../../../src/utils/guildbank/guildBankScan");
const { tempStoreFile } = require("../../helpers/tempStore");

const SPINAL = 32470;
const PYRE = 32471;
const HIDDEN = 32472;
const NOW = 1_800_000_000_000;
let KEY;

/** A tbc bank: Crimson Spinal and Pyrestone on "give" (by count), one item only in a hidden tab. */
function seedBank({ spinal = 0, pyre = 0, scannedAt = 1791000000 } = {}) {
    const items = [];
    if (spinal) items.push({ itemId: SPINAL, count: spinal });
    if (pyre) items.push({ itemId: PYRE, count: pyre });
    const scan = parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project: "tbc" }, guild: { name: "Die Gilde", realm: "Spineshatter", faction: "Horde" },
        scannedAt, tabs: [{ index: 1, name: "A", items }, { index: 2, name: "Lager", items: [{ itemId: HIDDEN, count: 3 }] }],
    });
    return stockStore.recordScan(scan, { now: 1, guildId: "g1" }).bank.key;
}

/** The bank once with every item seen, its settings and English names. */
function setUpBank() {
    // the first scan brings every item in (settings are only made for seen items)
    const scan = parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project: "tbc" }, guild: { name: "Die Gilde", realm: "Spineshatter", faction: "Horde" },
        scannedAt: 1790000000, tabs: [{ index: 1, name: "A", items: [{ itemId: SPINAL, count: 1 }, { itemId: PYRE, count: 1 }] }, { index: 2, name: "Lager", items: [{ itemId: HIDDEN, count: 3 }] }],
    });
    KEY = stockStore.recordScan(scan, { now: 1, guildId: "g1" }).bank.key;
    stockStore.setItemMeta("tbc", SPINAL, { name: "Crimson Spinal", icon: "inv_spinal" }, { source: "wowhead" });
    stockStore.setItemMeta("tbc", PYRE, { name: "Pyrestone", icon: "inv_pyre" }, { source: "wowhead" });
    stockStore.setItemMeta("tbc", HIDDEN, { name: "Hidden Gem", icon: "inv_gem" }, { source: "wowhead" });
    for (const id of [SPINAL, PYRE, HIDDEN]) stockStore.setItemSettings(KEY, id, { status: "give" });
    stockStore.setTabHidden(KEY, 2, true);
}

/** A newer scan with these counts (an item not in it reads 0). */
const rescan = (counts, at = 1792000000) => seedBank({ ...counts, scannedAt: at });

const wait = (over = {}, now = NOW) => store.addWaiting({
    userId: "u1", userName: "Anna", bankKey: KEY, itemId: SPINAL, item: "Crimson Spinal", amount: 1, ...over,
}, { now }).request;

beforeAll(() => {
    store.useFile(tempStoreFile("guild-bank.json"));
    stockStore.useFile(tempStoreFile("guild-bank-stock.json"));
    profiles.useFile(tempStoreFile("profiles.json"));
});
afterAll(() => {
    store.useFile(null);
    stockStore.useFile(null);
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    for (const r of store.listRequests()) store.removeRequest(r.id);
    for (const b of stockStore.listBanks()) stockStore.removeBank(b.key);
    profiles.reset();
    setUpBank();
    rescan({});
});

describe("services/guildbank/waitlist — allocate", () => {
    it("serves strictly in order: the first in full before the next gets anything", () => {
        const queue = [{ id: "a", amount: 3 }, { id: "b", amount: 1 }, { id: "c", amount: 2 }];
        expect(waitlist.allocate(queue, 0)).toEqual([]);
        expect(waitlist.allocate(queue, 2)).toEqual([{ id: "a", amount: 2, full: false }]);
        expect(waitlist.allocate(queue, 3)).toEqual([{ id: "a", amount: 3, full: true }]);
        expect(waitlist.allocate(queue, 5)).toEqual([{ id: "a", amount: 3, full: true }, { id: "b", amount: 1, full: true }, { id: "c", amount: 1, full: false }]);
        expect(waitlist.allocate(queue, 99)).toHaveLength(3);
        expect(waitlist.allocate([{ id: "x", amount: 0 }, { id: "y", amount: 1 }], 1)).toEqual([{ id: "y", amount: 1, full: true }]);
        expect(waitlist.allocate(null, "zwei")).toEqual([]);
    });
});

describe("services/guildbank/waitlist — moving up", () => {
    it("moves the first up as far as the stock goes; a part keeps the rest first in line", () => {
        const a = wait({ amount: 3 }, NOW);
        const b = wait({ userId: "u2", userName: "Bert", amount: 1 }, NOW + 1);
        expect(waitlist.promoteItem(KEY, SPINAL)).toEqual([]);
        rescan({ spinal: 2 });
        const moved = waitlist.promoteItem(KEY, SPINAL, { now: NOW + 10 });
        expect(moved).toHaveLength(1);
        expect(moved[0].request).toMatchObject({ status: "open", amount: 2, fromWaitlist: true, userId: "u1", createdAt: NOW + 10 });
        expect(moved[0].rest).toMatchObject({ id: a.id, status: "waiting", amount: 1, queueRank: 1 });
        // Bert gets nothing while Anna is not served in full
        expect(waitlist.listForBank(KEY).map((r) => [r.id, r.amount, r.position])).toEqual([[a.id, 1, 1], [b.id, 1, 2]]);
        expect(waitlist.freeOf(KEY, SPINAL)).toBe(0);
    });

    it("never hands the same stock out twice: a second scan with open requests moves nobody up", () => {
        wait({ amount: 2 }, NOW);
        wait({ userId: "u2", amount: 2 }, NOW + 1);
        rescan({ spinal: 2 });
        expect(waitlist.promoteBank(KEY)).toHaveLength(1);
        // the same stock scanned again: the open request of 2 is promised already
        rescan({ spinal: 2 }, 1792000001);
        expect(waitlist.promoteBank(KEY)).toEqual([]);
        rescan({ spinal: 4 }, 1792000002);
        const moved = waitlist.promoteBank(KEY);
        expect(moved.map((m) => [m.request.userId, m.request.amount, m.rest])).toEqual([["u2", 2, null]]);
        expect(store.waitingQueue(KEY)).toEqual([]);
    });

    it("moves nothing up for an item that is not offered or lies only in a hidden tab", () => {
        wait({ itemId: HIDDEN });
        expect(waitlist.freeOf(KEY, HIDDEN)).toBe(0);
        expect(waitlist.promoteBank(KEY)).toEqual([]);
        rescan({ spinal: 5 });
        wait({ itemId: SPINAL });
        stockStore.setItemSettings(KEY, SPINAL, { status: "show" });
        expect(waitlist.promoteBank(KEY, { itemId: SPINAL })).toEqual([]);
        stockStore.setItemSettings(KEY, SPINAL, { status: "give" });
        expect(waitlist.promoteBank(KEY, { itemId: SPINAL })).toHaveLength(1);
    });

    it("keeps an empty item with its settings, name and icon (it is not in the scan any more)", () => {
        rescan({ pyre: 1 });
        const item = stockStore.getBank(KEY).items.find((it) => it.itemId === SPINAL);
        expect(item).toMatchObject({ count: 0, status: "give", name: "Crimson Spinal", icon: "inv_spinal" });
        expect(waitlist.positionOf(wait())).toBe(1);
        expect(waitlist.positionOf(null)).toBe(0);
    });
});

describe("services/guildbank/waitlist — import", () => {
    const MONDAY = [
        "Whapap\tCrimson Spinal\t1", "Alîna\tCrimson Spinal\t2", "Gentle\tCrimson Spinal\t2", "Skerra\tCrimson Spinal\t1",
        "Gentle\tCrimson Spinal\t3", "Gentle\tPyrestone\t3", "Cherrylol\tCrimson Spinal\t1", "Rageholic\tCrimson Spinal\t1",
        "Josh\tCrimson Spinal\t1", "Josh\tPyrestone\t1", "Josh\tCrimson Spinal\t3", "Rasheedz\tPyrestone\t1",
        "Gentle\tPyrestone\t3", "Cherrylol\tCrimson Spinal\t1", "Brando\tPyrestone\t2",
    ].join("\r\n");

    it("reads tab-, semicolon- and comma-separated lines; the amount defaults to 1", () => {
        expect(waitlist.parseImport("Whapap\tCrimson Spinal\t1\n\nAlîna;Crimson Spinal;2\nJosh, Pyrestone, 3\nBrando,Pyrestone")).toEqual([
            { line: 1, name: "Whapap", itemText: "Crimson Spinal", amount: 1, error: "" },
            { line: 3, name: "Alîna", itemText: "Crimson Spinal", amount: 2, error: "" },
            { line: 4, name: "Josh", itemText: "Pyrestone", amount: 3, error: "" },
            { line: 5, name: "Brando", itemText: "Pyrestone", amount: 1, error: "" },
        ]);
        expect(waitlist.parseImport("Ann, Flask of Pure Death, Large, 2")[0]).toMatchObject({ itemText: "Flask of Pure Death, Large", amount: 2 });
        expect(waitlist.parseImport("Nur ein Name")[0].error).toBe("Name und Gegenstand fehlen.");
        expect(waitlist.parseImport("Ann\tPyrestone\t0")[0].error).toBe("Die Menge muss eine ganze Zahl von 1 bis 9999 sein.");
        expect(waitlist.parseImport("")).toEqual([]);
    });

    it("finds items and raiders without case and accents; unknown items and hidden ones are refused", () => {
        profiles.addCharacter("u-alina", { source: "log", name: "Alina", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
        profiles.saveProfile("u-alina", {}, { name: "Ali" });
        profiles.addCharacter("u-josh1", { source: "log", name: "Josh", className: "Mage", specs: [{ key: "Mage-Frost", gear: "ready" }] });
        profiles.addCharacter("u-josh2", { source: "log", name: "Josh", className: "Rogue", specs: [{ key: "Rogue-Combat", gear: "ready" }] });
        const { rows } = waitlist.previewImport(KEY, "Alîna\tcrimson spinal\t2\nJosh\tPyrestone\t1\nNobody\tPyrestone\t1\nX\tDragon Egg\t1\nY\tHidden Gem\t1\nZ\t" + SPINAL + "\t1");
        expect(rows.map((r) => [r.name, r.item ? r.item.name : "", r.itemError, r.match ? r.match.userId : "", r.ambiguous, r.ok])).toEqual([
            ["Alîna", "Crimson Spinal", "", "u-alina", false, true],
            ["Josh", "Pyrestone", "", "", true, true],
            ["Nobody", "Pyrestone", "", "", false, true],
            ["X", "", "Unbekannter Gegenstand.", "", false, false],
            ["Y", "Hidden Gem", "Nicht ausgebbar.", "", false, false],
            ["Z", "Crimson Spinal", "", "", false, true],
        ]);
        expect(rows[0].match).toEqual({ userId: "u-alina", userName: "Ali", characterKey: "alina", characterName: "Alina", realm: "", className: "Priest" });
        expect(rows[0].linked).toBe(true);
        expect(waitlist.previewImport("nope", "a\tb\t1")).toEqual({ rows: [] });
        expect(waitlist.foldName("  Alîna  Ölund ")).toBe("alina olund");
    });

    it("imports the Monday list in its order — matched raiders and bare characters — and skips nothing known", () => {
        profiles.addCharacter("u-gentle", { source: "log", name: "Gentle", className: "Paladin", specs: [{ key: "Paladin-Holy", gear: "ready" }] });
        const result = waitlist.importLines(KEY, MONDAY, { by: "o1", byName: "Orga", now: NOW });
        expect(result.skipped).toBe(0);
        expect(result.added).toHaveLength(15);
        const spinal = waitlist.listForBank(KEY).filter((r) => r.itemId === SPINAL);
        expect(spinal.map((r) => [r.position, r.characterName, r.amount])).toEqual([
            [1, "Whapap", 1], [2, "Alîna", 2], [3, "Gentle", 2], [4, "Skerra", 1], [5, "Gentle", 3], [6, "Cherrylol", 1],
            [7, "Rageholic", 1], [8, "Josh", 1], [9, "Josh", 3], [10, "Cherrylol", 1],
        ]);
        expect(spinal[2]).toMatchObject({ userId: "u-gentle", realm: "Spineshatter", faction: "Horde", addedBy: "o1", addedByName: "Orga" });
        expect(spinal[0]).toMatchObject({ userId: "", userName: "Whapap", status: "waiting" });
        expect(waitlist.listForBank(KEY).filter((r) => r.itemId === PYRE).map((r) => r.characterName)).toEqual(["Gentle", "Josh", "Rasheedz", "Gentle", "Brando"]);
        // the orga's entries are not limited by MAX_WAITING
        expect(store.waitingCount("u-gentle")).toBe(4);
        // stock comes in: Whapap (1) and Alîna (2) of 3
        rescan({ spinal: 3 });
        expect(waitlist.promoteBank(KEY).map((m) => [m.request.characterName, m.request.amount, m.request.userId])).toEqual([["Whapap", 1, ""], ["Alîna", 2, ""]]);
        expect(waitlist.importLines(KEY, "")).toEqual({ error: "Keine Zeile zum Importieren." });
        expect(waitlist.importLines("nope", MONDAY)).toEqual({ error: "Gildenbank nicht gefunden." });
    });

    it("adds one entry for the orga: a matched raider or a bare character, an offered item, an amount", () => {
        profiles.addCharacter("u1", { source: "log", name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
        const { request } = waitlist.addEntry(KEY, { name: "zibbo", itemId: PYRE, amount: "2", by: "o1", byName: "Orga" }, { now: NOW });
        expect(request).toMatchObject({ userId: "u1", characterName: "Zibbo", itemId: PYRE, amount: 2, item: "Pyrestone", status: "waiting" });
        expect(waitlist.addEntry(KEY, { name: "Fremd", itemId: PYRE, amount: 1 }).request).toMatchObject({ userId: "", characterName: "Fremd", addedBy: "web" });
        expect(waitlist.addEntry(KEY, { name: "", itemId: PYRE, amount: 1 })).toEqual({ error: "Bitte einen Namen angeben." });
        expect(waitlist.addEntry(KEY, { name: "A", itemId: HIDDEN, amount: 1 })).toEqual({ error: "Diesen Gegenstand gibt die Bank nicht aus." });
        expect(waitlist.addEntry(KEY, { name: "A", itemId: PYRE, amount: 0 })).toEqual({ error: "Die Menge muss eine ganze Zahl von 1 bis 9999 sein." });
        expect(waitlist.addEntry("nope", { name: "A", itemId: PYRE, amount: 1 })).toEqual({ error: "Gildenbank nicht gefunden." });
    });
});

describe("services/guildbank/waitlist — linking in the import and the list", () => {
    it("lists ambiguous candidates, takes the orga's picks and counts what lands unlinked", () => {
        profiles.addCharacter("u-a", { source: "log", name: "Josh", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] }, { name: "Anna" });
        profiles.addCharacter("u-b", { source: "log", name: "Josh", className: "Mage", specs: [{ key: "Mage-Frost", gear: "ready" }] }, { name: "Bert" });
        profiles.addCharacter("u-c", { source: "log", name: "Ragemain", className: "Warrior" }, { name: "Cleo" });
        const text = "Josh\tCrimson Spinal\t1\nRageholic\tCrimson Spinal\t1\nWhapap\tCrimson Spinal\t1";
        const { rows } = waitlist.previewImport(KEY, text);
        expect(rows[0]).toMatchObject({ ambiguous: true, linked: false, match: null });
        expect(rows[0].candidates.map((c) => [c.userId, c.characterKey, c.className])).toEqual([["u-a", "josh", "Priest"], ["u-b", "josh", "Mage"]]);
        expect(rows[1]).toMatchObject({ ambiguous: false, linked: false, candidates: [] });

        const links = { 1: { userId: "u-b", characterKey: "josh" }, 2: { userId: "u-c", characterKey: "ragemain" }, 3: { userId: "u-c", characterKey: "nope" } };
        const picked = waitlist.previewImport(KEY, text, { links }).rows;
        expect(picked.map((r) => [r.linked, r.picked, r.match && r.match.userId])).toEqual([[true, true, "u-b"], [true, true, "u-c"], [false, false, null]]);

        const result = waitlist.importLines(KEY, text, { by: "o1", byName: "Orga", links });
        expect(result.unlinked).toBe(1);
        expect(result.added.map((r) => [r.userId, r.userName, r.characterName])).toEqual([["u-b", "Bert", "Josh"], ["u-c", "Cleo", "Ragemain"], ["", "Whapap", "Whapap"]]);
        expect(waitlist.listForBank(KEY).map((e) => e.linked)).toEqual([true, true, false]);
    });

    it("adds one entry for a picked profile character, refuses a pick the profile does not have", () => {
        profiles.addCharacter("u-c", { source: "log", name: "Ragemain", className: "Warrior" }, { name: "Cleo" });
        const added = waitlist.addEntry(KEY, { userId: "u-c", characterKey: "ragemain", itemId: SPINAL, amount: 2, by: "o1" });
        expect(added.request).toMatchObject({ userId: "u-c", characterName: "Ragemain", amount: 2 });
        expect(waitlist.addEntry(KEY, { userId: "u-c", characterKey: "nope", itemId: SPINAL, amount: 1 })).toEqual({ error: "Diesen Charakter gibt es im Profil nicht." });
    });

    // "Gentle" typed at a signup, the real characters are "Gentleowl" and "Gentletwowl"
    it("never links a name to a character nobody confirmed: the raider's confirmed characters are the candidates", () => {
        profiles.addCharacter("u-g", { name: "Gentle", className: "Druid" }, { name: "Gentle" });
        profiles.addCharacter("u-g", { source: "log", name: "Gentleowl", className: "Druid" });
        profiles.addCharacter("u-g", { source: "log", name: "Gentletwowl", className: "Priest" });
        expect(waitlist.matchCharacter("Gentle", "tbc")).toEqual({
            suggested: true, unverified: true,
            candidates: [
                { userId: "u-g", userName: "Gentle", characterKey: "gentleowl", characterName: "Gentleowl", realm: "", className: "Druid" },
                { userId: "u-g", userName: "Gentle", characterKey: "gentletwowl", characterName: "Gentletwowl", realm: "", className: "Priest" },
            ],
        });
        const text = "Gentle\tCrimson Spinal\t2\nGentleowl\tPyrestone\t1";
        const { rows } = waitlist.previewImport(KEY, text);
        expect(rows[0]).toMatchObject({ match: null, linked: false, ambiguous: false, unverified: true, ok: true });
        expect(rows[0].candidates.map((c) => c.characterName)).toEqual(["Gentleowl", "Gentletwowl"]);
        expect(rows[1]).toMatchObject({ match: { userId: "u-g", characterName: "Gentleowl" }, linked: true, unverified: false, candidates: [] });

        // imported without a pick: the bare name, not linked; with a chip picked: linked
        const bare = waitlist.importLines(KEY, text, { by: "o1" });
        expect(bare.added.map((r) => [r.userId, r.characterName])).toEqual([["", "Gentle"], ["u-g", "Gentleowl"]]);
        expect(bare.unlinked).toBe(1);
        const picked = waitlist.importLines(KEY, "Gentle\tCrimson Spinal\t2", { links: { 1: { userId: "u-g", characterKey: "gentletwowl" } } });
        expect(picked.added.map((r) => [r.userId, r.characterName])).toEqual([["u-g", "Gentletwowl"]]);
        expect(picked.unlinked).toBe(0);

        // the unconfirmed character itself cannot be picked — neither in the import nor for one entry
        expect(waitlist.importLines(KEY, text, { links: { 1: { userId: "u-g", characterKey: "gentle" } } })).toEqual({
            error: "Zeile 1: Gentle ist nicht bestätigt – erst im Arsenal oder im Spiel prüfen, dann verknüpfen.",
        });
        expect(waitlist.addEntry(KEY, { userId: "u-g", characterKey: "gentle", itemId: SPINAL, amount: 1 })).toEqual({
            error: "Gentle ist nicht bestätigt – erst im Arsenal oder im Spiel prüfen, dann verknüpfen.",
        });
        expect(waitlist.addEntry(KEY, { name: "Gentle", itemId: SPINAL, amount: 1 }).request).toMatchObject({ userId: "", characterName: "Gentle" });
    });

    it("lists an entry whose raider's character is unconfirmed as such, linked once the orga checked it", () => {
        profiles.addCharacter("u-g", { name: "Gentle", className: "Druid" }, { name: "Gentle" });
        // stored before the rule: the raider and the typed name
        store.addWaiting({ userId: "u-g", userName: "Gentle", characterName: "Gentle", item: "Crimson Spinal", amount: 1, bankKey: KEY, itemId: SPINAL });
        store.addWaiting({ userId: "", userName: "Whapap", characterName: "Whapap", item: "Crimson Spinal", amount: 1, bankKey: KEY, itemId: SPINAL });
        expect(waitlist.listForBank(KEY).map((e) => [e.characterName, e.linked, e.linkProblem])).toEqual([["Gentle", false, "unverified"], ["Whapap", false, "none"]]);
        profiles.verifyCharacter("u-g", "gentle", { by: "o1", byName: "Orga" });
        expect(waitlist.listForBank(KEY)[0]).toMatchObject({ linked: true, linkProblem: "" });
    });

    it("offers the confirmed characters a name starts, even without a profile character of that name", () => {
        profiles.addCharacter("u-g", { source: "log", name: "Gentleowl", className: "Druid" }, { name: "Owl" });
        expect(waitlist.matchCharacter("Gentle", "tbc")).toMatchObject({ suggested: true, unverified: false, candidates: [{ characterName: "Gentleowl" }] });
        expect(waitlist.matchCharacter("Nobody", "tbc")).toBeNull();
    });

    // #741: a TBC bank only ever matches or takes TBC characters
    it("matches and takes only characters of the bank's version; a name of another version's character stays a bare name", () => {
        profiles.addCharacter("u-f", { source: "log", name: "Devi", className: "Mage" }, { name: "Fio", versionId: "forever" });
        const devi = profiles.getProfile("u-f").characters.find((c) => c.name === "Devi");
        expect(waitlist.matchCharacter("Devi", "tbc")).toBeNull();
        expect(waitlist.matchCharacter("Devi", "forever")).toMatchObject({ userId: "u-f", characterName: "Devi" });
        expect(waitlist.matchCharacter("Devi")).toMatchObject({ userId: "u-f" });
        // typed: imported unlinked under the name; picked: refused
        expect(waitlist.addEntry(KEY, { name: "Devi", itemId: SPINAL, amount: 1 }).request).toMatchObject({ userId: "", characterName: "Devi" });
        expect(waitlist.addEntry(KEY, { userId: "u-f", characterKey: devi.key, itemId: SPINAL, amount: 1 })).toEqual({
            error: "Devi ist ein Forever-Charakter – diese Gildenbank ist für TBC. Bitte einen TBC-Charakter wählen.",
        });
        const text = "Devi\tCrimson Spinal\t1\nDevi\tCrimson Spinal\t2";
        expect(waitlist.previewImport(KEY, text).rows.map((r) => [r.ok, r.linked])).toEqual([[true, false], [true, false]]);
        const refused = waitlist.importLines(KEY, text, { links: { 2: { userId: "u-f", characterKey: devi.key } } });
        expect(refused).toEqual({ error: "Zeile 2: Devi ist ein Forever-Charakter – diese Gildenbank ist für TBC. Bitte einen TBC-Charakter wählen." });
    });
});
