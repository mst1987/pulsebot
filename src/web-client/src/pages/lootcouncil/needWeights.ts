// The weighting the council's numbers were computed with (#668), for every need
// bar on a page: the server sends it with each council answer (`weights`), the
// page puts it here once, and NeedBar stacks its four parts in exactly these
// shares. Without a provider (a test, an old answer) the defaults apply.
import { createContext, createElement, useContext, type ReactNode } from "react";
import type { CouncilRaider, CouncilWeightsView, NeedShares } from "../../api";
import { locale, type TFunction } from "../../i18n";
import type { NeedSubject } from "./NeedBar";

/** The server's defaults (stores/councilWeightsStore.js): 45 / 30 / 10 / 15. */
export const DEFAULT_SHARES: NeedShares = { drought: 0.45, share: 0.3, need: 0.1, tenure: 0.15 };
export const DEFAULT_TENURE_DAYS = 90;

type Ctx = { shares: NeedShares; tenureDays: number };
const NeedWeightsContext = createContext<Ctx>({ shares: DEFAULT_SHARES, tenureDays: DEFAULT_TENURE_DAYS });

export function NeedWeightsProvider({ weights, children }: { weights: CouncilWeightsView | null | undefined; children: ReactNode }) {
    const value: Ctx = {
        shares: (weights && weights.needShares) || DEFAULT_SHARES,
        tenureDays: (weights && weights.tenureDays) || DEFAULT_TENURE_DAYS,
    };
    return createElement(NeedWeightsContext.Provider, { value }, children);
}

/** The shares the need bar is stacked in, and the tenure saturation. */
export function useNeedWeights(): Ctx {
    return useContext(NeedWeightsContext);
}

/** A loot-point number the way the reader writes it: "5,5" / "5.5", whole numbers without a decimal. */
export function fmtPoints(n: number | undefined | null): string {
    const v = Math.round((Number(n) || 0) * 10) / 10;
    return new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(v);
}

/** A share of 1 as a whole percent ("45"). */
export const pct = (share: number) => Math.round((Number(share) || 0) * 100);

/** "3 Items · 5,5 Punkte" — the count with its loot points. */
export function lootLabel(t: TFunction, count: number, points: number | undefined): string {
    return t("lootcouncil.items.countPoints", {
        items: t("lootcouncil.word.itemCount", { count }),
        points: t("lootcouncil.items.points", { count: Number(points) || 0, points: fmtPoints(points) }),
    });
}

/** A roster row as the need bar reads it (the list and the dialog alike). */
export function needSubject(r: CouncilRaider): NeedSubject {
    return {
        needScore: r.needScore, needParts: r.needParts, daysSinceLoot: r.daysSinceLoot,
        lootCount: r.lootCount, bisOwned: r.bis.owned, bisTotal: r.bis.total,
        lootPoints: r.lootPoints, droughtDays: r.droughtDays, tenureDays: r.tenureDays,
    };
}
