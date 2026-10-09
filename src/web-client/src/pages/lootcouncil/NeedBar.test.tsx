// The need bar and the loot count with the council's weighting (#668): the
// bar is stacked in the shares the answer carries (four parts, a part weighted
// 0 drops out), the count says "3 Items · 5,5 Punkte".
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CouncilWeightsView } from "../../api";
import { NeedBar } from "./NeedBar";
import { LootCount } from "./ItemBits";
import { NeedWeightsProvider, fmtPoints, lootLabel, needSubject } from "./needWeights";
import { t } from "../../i18n";
import { councilData } from "../../test/councilFixtures";

const subject = {
    needScore: 0.6, needParts: { drought: 1, share: 0.5, need: 0.2, tenure: 0.5 }, daysSinceLoot: 40,
    lootCount: 3, lootPoints: 5.5, droughtDays: 30, tenureDays: 45, bisOwned: 4, bisTotal: 10,
};
const fills = (container: HTMLElement) => [...container.querySelectorAll(".lc-needbar i")].map((i) => (i as HTMLElement).style.getPropertyValue("--fill"));

const weights = (needShares: CouncilWeightsView["needShares"]): CouncilWeightsView => ({
    scope: "global", classes: { trinket: 2, bisWeapon: 2, weapon: 1.5, set: 1, normal: 1, frequent: 0.5 }, items: {},
    need: { drought: 45, share: 30, need: 10, tenure: 15 }, needShares, tenureDays: 90, droughtDays: 30,
});

describe("NeedBar with the council's weighting", () => {
    it("stacks four parts in the default shares without a provider", () => {
        const { container } = render(<NeedBar subject={subject} />);
        // drought 1 × 45, share 0.5 × 30, need 0.2 × 10, tenure 0.5 × 15
        expect(fills(container)).toEqual(["45%", "15%", "2%", "7.5%"]);
        expect(screen.getByText("Bedarf 60")).toBeInTheDocument();
    });

    it("follows the shares the answer carries and drops a part weighted 0", () => {
        const { container } = render(
            <NeedWeightsProvider weights={weights({ drought: 0.5, share: 0.5, need: 0, tenure: 0 })}>
                <NeedBar subject={subject} />
            </NeedWeightsProvider>,
        );
        expect(fills(container)).toEqual(["50%", "25%"]);
    });
});

describe("loot points", () => {
    it("writes points the reader's way", () => {
        expect(fmtPoints(5.5)).toBe("5,5");
        expect(fmtPoints(2)).toBe("2");
        expect(fmtPoints(undefined)).toBe("0");
        expect(lootLabel(t, 3, 5.5)).toBe("3 Items · 5,5 Punkte");
        expect(lootLabel(t, 2, 1)).toBe("2 Items · 1 Punkt");
    });

    it("shows the count with its points under it", () => {
        render(<LootCount items={[]} total={3} points={5.5} />);
        expect(screen.getByText("3")).toBeInTheDocument();
        expect(screen.getByText("5,5 Punkte")).toBeInTheDocument();
    });

    it("reads a roster row into the need bar's subject", () => {
        const row = { ...councilData().roster[0], lootPoints: 4, droughtDays: 12, tenureDays: 30 };
        expect(needSubject(row)).toMatchObject({ lootCount: row.lootCount, lootPoints: 4, droughtDays: 12, tenureDays: 30, bisTotal: row.bis.total });
    });
});
