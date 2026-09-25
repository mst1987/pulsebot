import { useMemo } from "react";
import type { Catalog, RaidplanAssignment, RaidplanBoard, RaidplanPlayer } from "../../../api";
import { cleanNames } from "../../../lib/mention";
import { splitMine } from "../../../lib/mineView";
import { MineBlocks } from "./ReadTables";
import { useT } from "../../../i18n";

/**
 * "Meine Aufgaben" / "Wirkt auf dich" as the logged-in organiser will see them in the read view, for the section he is editing (foldable; it follows the
 * effective rows - own and inherited, class references resolved - so an edit shows up at once). Nothing when he is not in the setup.
 */
export default function MyTasksPreview({ rows, board, players, catalog, me }: { rows: RaidplanAssignment[]; board: RaidplanBoard; players: Map<string, RaidplanPlayer>; catalog: Catalog | null; me: string[] }) {
    const t = useT();
    const ctx = useMemo(() => ({ slots: board.slots, players, catalog, groupColors: board.groupColors, groupMarks: board.groupMarks, roles: board.roles, icons: board.icons }), [board.slots, board.groupColors, board.groupMarks, board.roles, board.icons, players, catalog]);
    const names = useMemo(() => cleanNames(me.map((id) => (players.get(id) || { character: "" }).character)), [me, players]);
    const split = useMemo(() => splitMine(rows, ctx, me, names), [rows, ctx, me, names]);
    if (me.length === 0) return null;
    const empty = split.mine.length === 0 && split.onMe.length === 0;
    return (
        <details className="rp-mypreview">
            <summary>{t("raidBoard.mine.preview")}</summary>
            {empty ? <p className="rp-muted">{t("raidBoard.read.notInPlan")}</p> : (
                <>
                    {split.mine.length > 0 && <section className="rp-mine"><h2>{t("raidBoard.mine.title")}</h2><MineBlocks blocks={split.mine} ctx={ctx} me={me} names={names} /></section>}
                    {split.onMe.length > 0 && <section className="rp-onme"><h2>{t("raidBoard.mine.onMe")}</h2><MineBlocks blocks={split.onMe} ctx={ctx} me={me} names={names} /></section>}
                </>
            )}
        </details>
    );
}
