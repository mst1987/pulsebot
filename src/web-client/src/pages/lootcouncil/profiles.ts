// Pure helpers of the council's head and profile tab (#676): the picker's
// value, and copies/comparisons of a profile's weighting and view.
import type { CouncilCategoryView, CouncilWeightSettings } from "../../api";

/** The picker's value: "roster:<id>", "category:<id>" or "" (every category). */
export function pickValue(view: { roster?: string; category: string }): string {
    if (view.roster) return `roster:${view.roster}`;
    return view.category ? `category:${view.category}` : "";
}

/** A picker value back as the view's two fields. */
export function pickFields(value: string): { roster: string; category: string } {
    if (value.startsWith("roster:")) return { roster: value.slice(7), category: "" };
    if (value.startsWith("category:")) return { roster: "", category: value.slice(9) };
    return { roster: "", category: "" };
}

/** A copy to edit, so the stored answer stays untouched until it is saved. */
export const cloneWeights = (s: CouncilWeightSettings): CouncilWeightSettings => ({
    classes: { ...s.classes },
    items: Object.fromEntries(Object.entries(s.items || {}).map(([id, e]) => [id, { ...e }])),
    need: { ...s.need },
    tenureDays: s.tenureDays,
});
export const sameWeights = (a: CouncilWeightSettings, b: CouncilWeightSettings) => JSON.stringify(cloneWeights(a)) === JSON.stringify(cloneWeights(b));

export const cloneView = (v: CouncilCategoryView): CouncilCategoryView => ({ ...v, tiers: [...v.tiers], contents: [...v.contents] });
export const sameView = (a: CouncilCategoryView, b: CouncilCategoryView) => JSON.stringify(cloneView(a)) === JSON.stringify(cloneView(b));
