// The figures behind the setup's summary, pure: the roles against the plan, the
// switches as they are set, the buffs. The bar's counts, the summary line and
// the "Details" tiles all read these (Summary.tsx, SetupEditor.tsx).
import type { SetupEditorData, StoredSetup } from "../../../api";
import { dpsCheck, roleTarget } from "../../../lib/signups/setupEditor";
import { rolePluralLabel } from "../../../lib/wow/wowNames";
import { t } from "../../../i18n";

/** One role against the plan: "Tanks 3 von 3" in the bar, a big tile in the details. */
export type RoleFigure = { key: string; label: string; value: number; target: string; ok: boolean; tip: string };

/** Tanks, Heiler and DD against the plan — the bar's counts and the details' tiles read the same numbers. */
export function roleFigures(setup: StoredSetup): RoleFigure[] {
    const { checks } = setup;
    const roles = checks.roles || {};
    const tank = roles.tank || { count: 0, min: 0, max: 0, ok: true };
    const healer = roles.healer || { count: 0, min: 0, max: 0, ok: true };
    const dps = dpsCheck(roles);
    // the places the plan leaves for damage dealers: size minus the planned tanks and healers
    const dpsTarget = checks.size.size ? Math.max(0, checks.size.size - (tank.max ?? tank.min) - (healer.max ?? healer.min)) : 0;
    return [
        { key: "tank", label: rolePluralLabel("tank"), value: tank.count, target: roleTarget(tank), ok: tank.ok, tip: t("setup.summary.planTip") },
        { key: "healer", label: rolePluralLabel("healer"), value: healer.count, target: roleTarget(healer), ok: healer.ok, tip: t("setup.summary.planTip") },
        {
            key: "dps", label: t("setup.summary.dps"), value: dps.count, target: dpsTarget ? String(dpsTarget) : "", ok: dps.ok && dps.count >= dpsTarget,
            tip: t("setup.summary.dpsTip", { melee: roles.melee?.count || 0, ranged: roles.ranged?.count || 0 }),
        },
    ];
}

/** The switches as the setup and the event set them: fairness, wishes, "nicht zusammen" (only with such pairs). */
export function summaryOptions(data: SetupEditorData, setup: StoredSetup) {
    return {
        fairness: typeof setup.options?.fairness === "boolean" ? setup.options.fairness : data.event.fairness,
        wishes: typeof setup.options?.wishes === "boolean" ? setup.options.wishes : data.event.wishes,
        // "nicht zusammen": only when there are such pairs among the signups; counts, never names
        avoid: setup.options?.avoid === true,
        avoidTotal: Math.max(data.avoidPairs || 0, setup.checks.avoid?.total || 0),
    };
}

/** What the buffs badge says, and its tooltip: required ones ticked or missing, the raid buffs nobody brings. */
export function buffState(setup: StoredSetup) {
    const { checks } = setup;
    const missingRequired = checks.buffs.required.filter((b) => !b.present);
    const missingRaid = checks.buffs.raid.filter((b) => !b.present);
    const tip = [
        checks.buffs.required.length
            ? t("setup.summary.required", { list: checks.buffs.required.map((b) => `${b.present ? "✓" : "–"} ${b.label}`).join(", ") })
            : t("setup.summary.noRequired"),
        missingRaid.length ? t("setup.summary.missingRaid", { list: missingRaid.map((b) => b.label).join(", ") }) : t("setup.summary.allRaid"),
    ].join("\n");
    return { missingRequired, missingRaid, tip };
}
