// "Angemeldet" on a phone shows one role tab at a time: it opens on the first role
// somebody stands in (all empty: tanks), and a tab picked by hand stays put while
// the list changes under it.
import { useState } from "react";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SetupPerson } from "../../../../api";
import { t } from "../../../../i18n";
import { renderPage } from "../../../../test/render";
import { MAGE, PRIEST, TANK } from "../../../../test/fixtures/setupEditor";
import type { Interaction } from "../Board";
import { PoolPanel } from "../PoolPanel";

const ui: Interaction = {
    editable: true, selected: null, dragging: null, attendance: {}, suggest: null, extraRoles: {},
    onInspect: vi.fn(), onPick: vi.fn(), onDrop: vi.fn(), onDrag: vi.fn(),
};

const panel = (pool: SetupPerson[]) => <PoolPanel pool={pool} ui={ui} />;

/** The panel with a button that swaps its list for `next` — a move elsewhere in the editor, without a remount. */
function Changing({ first, next }: { first: SetupPerson[]; next: SetupPerson[] }) {
    const [pool, setPool] = useState(first);
    return <><button type="button" onClick={() => setPool(next)}>swap</button>{panel(pool)}</>;
}
const tabs = () => within(screen.getByRole("group", { name: t("setup.poolPanel.tabs") }));
const tab = (role: string) => tabs().getByRole("button", { name: new RegExp(`^${t(`setup.poolPanel.sections.${role}`)}`) });
const onTab = () => tabs().getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true");

describe("the role tabs of \"Angemeldet\"", () => {
    it("open on the first role somebody stands in, not on empty tanks", () => {
        renderPage(panel([PRIEST]));
        expect(onTab()).toEqual([tab("healer")]);
    });

    it("fall back to tanks when the search leaves every role empty", async () => {
        const user = userEvent.setup();
        renderPage(panel([PRIEST]));
        await user.type(screen.getByRole("searchbox", { name: t("setup.poolPanel.search") }), "zzz");
        expect(onTab()).toEqual([tab("tank")]);
    });

    it("follow the list while nobody picked one", async () => {
        const user = userEvent.setup();
        renderPage(<Changing first={[MAGE]} next={[TANK, MAGE]} />);
        expect(onTab()).toEqual([tab("ranged")]);
        await user.click(screen.getByRole("button", { name: "swap" }));
        expect(onTab()).toEqual([tab("tank")]);
    });

    it("keep a tab picked by hand when the list changes, even when it runs empty", async () => {
        const user = userEvent.setup();
        renderPage(<Changing first={[PRIEST, MAGE]} next={[TANK, PRIEST]} />);
        await user.click(tab("ranged"));
        expect(onTab()).toEqual([tab("ranged")]);
        await user.click(screen.getByRole("button", { name: "swap" }));
        expect(onTab()).toEqual([tab("ranged")]);
    });
});
