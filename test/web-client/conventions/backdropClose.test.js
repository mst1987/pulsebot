// A dialog closes on a click beside it only when the press was beside it too
// (hooks/useBackdropClose.ts, docs/web-admin.md). The bare check
// `e.target === e.currentTarget` on a click closed a dialog when text selected
// inside was let go outside — the click then lands on the <dialog> itself.
const { clientSources, stripComments } = require("../clientSource");

describe("closing a dialog on its backdrop", () => {
    it("goes through useBackdropClose, never a bare click check on the dialog", () => {
        const offenders = clientSources()
            .filter(([rel]) => rel !== "hooks/useBackdropClose.ts")
            .filter(([, src]) => /onClick=\{\(?\w*\)?\s*=>\s*\{?\s*if \(\w+\.target === \w+\.currentTarget\)/.test(stripComments(src)))
            .map(([rel]) => rel);
        expect(offenders).toEqual([]);
    });

    it("is used by the shared Modal and the loot council's own dialog", () => {
        const sources = Object.fromEntries(clientSources());
        for (const rel of ["components/ui/Modal.tsx", "pages/lootcouncil/RaiderDialog.tsx"]) {
            expect({ rel, uses: sources[rel].includes("{...backdrop}") && sources[rel].includes("useBackdropClose(onClose)") }).toEqual({ rel, uses: true });
        }
    });
});
