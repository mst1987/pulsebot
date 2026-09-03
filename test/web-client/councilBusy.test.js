// Guards for the loot council's per-action busy state
// (src/web-client/src/pages/LootCouncilPage.tsx).
//
// Setting a raider aside takes a write plus a full reload — long enough that
// without feedback the natural response is to click again, which fires the
// request twice. There is no React test renderer in this project, so what is
// checked here are the invariants that would rot silently:
//   * every per-raider action goes through the one helper that guards it,
//   * the buttons are actually disabled while their own action runs,
//   * the busy key is per raider, so one spinner cannot claim another's row,
//   * the reload is awaited, so the spinner outlives the write itself.
const fs = require("fs");
const path = require("path");

const PAGE = path.join(__dirname, "..", "..", "src", "web-client", "src", "pages", "LootCouncilPage.tsx");
const src = fs.readFileSync(PAGE, "utf8");

describe("loot council — busy state", () => {
    it("guards against a second click while one is in flight", () => {
        // The early return in runFor is the whole protection: without it a
        // double click sends the request twice.
        expect(src).toMatch(/if \(busy\.has\(key\)\) return;/);
    });

    it("routes both per-raider actions through that guard", () => {
        expect(src).toMatch(/const showExport = \(character: string\) => runFor\(/);
        expect(src).toMatch(/const setExcluded = \(character: string, excluded: boolean\) => runFor\(/);
    });

    it("keys the busy state per action and raider", () => {
        // A shared flag would grey out every row's button at once.
        expect(src).toMatch(/`export:\$\{character\}`/);
        expect(src).toMatch(/`exclude:\$\{character\}`/);
    });

    it("disables each button while its own action runs", () => {
        for (const key of ["export", "exclude"]) {
            expect(src).toContain(`disabled={busy.has(\`${key}:\${r.character}\`)}`);
        }
        // ...including the one that takes a raider back in.
        expect(src).toContain("disabled={busy.has(`exclude:${e.character}`)}");
    });

    it("shows a spinner in the button rather than blanking the page", () => {
        // A page overlay for a half-second row action loses the reader's place.
        expect(src).toMatch(/<ButtonSpinner \/>Wird abgelegt/);
        expect(src).toMatch(/<ButtonSpinner \/>Wird aufgenommen/);
        expect(src).toMatch(/<ButtonSpinner \/>Wird geholt/);
    });

    it("clears the busy key even when the action fails", () => {
        // Otherwise a failed request leaves the button dead for good.
        expect(src).toMatch(/} finally \{\s*setBusy\(\(prev\) => \{/);
    });

    it("keeps the spinner until the reloaded list is on screen", () => {
        // The write returning is not the point — the new numbers are, and the
        // whole roster's need scores shift when one raider leaves it.
        // `reloadAll` rather than `load`: der geprüfte Drop hängt an denselben
        // Daten und wäre sonst bis zum nächsten Filterwechsel veraltet.
        expect(src).toMatch(/await setCouncilExcluded\(csrfToken, character, excluded\);\s*await reloadAll\(\);/);
        expect(src).toMatch(/return getLootCouncil\(/);
    });

    it("refreshes the checked drop along with the list", () => {
        // Sonst zeigt „Drop prüfen" nach einem Armory-Update oder einem
        // beiseitegelegten Raider weiter die alten Zugewinne, bis jemand die
        // Seite neu lädt.
        expect(src).toMatch(/const reloadAll = useCallback\(async \(\) => \{\s*setDataToken/);
        expect(src).toMatch(/await refreshCouncilArmory\(csrfToken, characters\);\s*await reloadAll\(\);/);
        // Und der Drop-Effekt hört auf den Token.
        expect(src).toMatch(/view\.bisTier, dataToken\]/);
    });

    it("does not hand the promise-returning load to useEffect", () => {
        // React would take the returned promise for a cleanup function.
        expect(src).not.toMatch(/useEffect\(load,/);
        expect(src).toMatch(/useEffect\(\(\) => \{ load\(\); \}, \[load\]\)/);
    });

    it("hides the spinner glyph from screen readers", () => {
        // The changed button label already announces the state.
        expect(src).toMatch(/className="lc-spin" aria-hidden="true"/);
    });
});
