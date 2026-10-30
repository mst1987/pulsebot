import { useCallback, useEffect, useRef } from "react";
import type { Besetzung, RaidplanBoard, RaidplanPlayer } from "../../../api";
import { useConfirm } from "../../ui";
import { useT } from "../../../i18n";
import { boardOf } from "../../../lib/raidplan";
import { DEFAULTS_KEY } from "../../../lib/raidplan/inherit";
import { applyTankLineup, differingKeys, sameOrder, tankLineup } from "../../../lib/raidplan/assign/tankOrder";

type Bosses = Record<string, Partial<RaidplanBoard>>;

/** At most this many section names in the question; the rest is "…". */
const NAMES_SHOWN = 6;

/**
 * "Soll die Tank-Reihenfolge auch für die anderen Bosse gelten?" Every section fills its tank slots in setup order; a
 * new tank line-up set in the Standard (order, number of tanks, who tanks) asks once whether the bosses (and trash) follow
 * it (lib/raidplan/assign/tankOrder.ts). Asked
 * when the editor leaves the Standard or saves on it - not on every click: a swap through the Besetzung's chips takes two
 * (Tank 1 = B empties Tank 2 until A is put there), so the order is only complete when the organiser is done.
 *
 * `leaving(next)` asks after the section has changed (a yes edits the other boards, one undo step); `beforeSave()` asks
 * first and hands back the plan to send (null = save the draft as it is), since the edit reaches the draft only on the
 * next render. The order the Standard had when it was opened (or last saved / asked) is the one compared against.
 */
export function useTankOrderFollow({ draft, selected, version, sections, fill, editAll, roster, besetzung, canWrite }: {
    draft: Bosses;
    selected: string;
    /** the saved plan's version: a save starts a new comparison */
    version: number;
    /** the sections that may follow: every boss and trash, with their names (not the Standard, not "Allgemein") */
    sections: { key: string; name: string }[];
    /** a board with its Besetzung filled, as the editor shows it (a boss never opened has no slots stored yet) */
    fill: (b: RaidplanBoard) => RaidplanBoard;
    /** one step over several boards (useDraftHistory's editAll) */
    editAll: (keys: string[], fn: (b: RaidplanBoard) => RaidplanBoard) => void;
    roster: RaidplanPlayer[];
    /** the plan's raid type: a boss that gets more or fewer tank slots keeps its other numbers */
    besetzung: Besetzung | null;
    canWrite: boolean;
}) {
    const t = useT();
    const ask = useConfirm();
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const fillRef = useRef(fill);
    fillRef.current = fill;
    const baseline = useRef<string[] | null>(null);
    const onStandard = selected === DEFAULTS_KEY;

    // the order to compare against: the Standard's when it is opened, and again after a save (not on a new roster)
    useEffect(() => {
        baseline.current = onStandard ? tankLineup(fillRef.current(boardOf(draftRef.current, DEFAULTS_KEY))) : null;
    }, [onStandard, version]);

    /** Asks when the Standard's tank line-up changed and some section differs; the plan with the line-up followed, or null. */
    const follow = useCallback(async (): Promise<Bosses | null> => {
        const before = baseline.current;
        if (!before || !canWrite) return null;
        const cur = draftRef.current;
        const at = (k: string) => fill(boardOf(cur, k));
        const want = tankLineup(at(DEFAULTS_KEY));
        if (sameOrder(want, before)) return null;
        baseline.current = want; // one question per change, whatever the answer
        const keys = differingKeys(at, sections.map((s) => s.key), want, besetzung, roster);
        if (keys.length === 0) return null;
        const names = sections.filter((s) => keys.includes(s.key)).map((s) => s.name);
        const tanks = want.map((u, i) => `${i + 1}. ${u ? (roster.find((p) => p.userId === u) || { character: u }).character : t("raidBoard.slot.open")}`).join(", ");
        const ok = await ask({
            title: t("raidBoard.tankOrder.title"),
            text: t(keys.length === 1 ? "raidBoard.tankOrder.textOne" : "raidBoard.tankOrder.text", {
                tanks, count: keys.length,
                bosses: names.length > NAMES_SHOWN ? `${names.slice(0, NAMES_SHOWN).join(", ")} …` : names.join(", "),
            }),
            action: t("raidBoard.tankOrder.action"),
            cancelLabel: t("raidBoard.tankOrder.cancel"),
            tone: "primary",
            icon: "ability_warrior_defensivestance",
        });
        if (!ok) return null;
        editAll(keys, (b) => applyTankLineup(fill(b), want, besetzung, roster));
        const next: Bosses = { ...cur };
        for (const k of keys) next[k] = applyTankLineup(at(k), want, besetzung, roster);
        return next;
    }, [ask, besetzung, canWrite, editAll, fill, roster, sections, t]);

    const leaving = useCallback((next: string) => {
        if (onStandard && next !== DEFAULTS_KEY) void follow();
    }, [follow, onStandard]);
    const beforeSave = useCallback(() => (onStandard ? follow() : Promise.resolve(null)), [follow, onStandard]);
    return { leaving, beforeSave };
}
