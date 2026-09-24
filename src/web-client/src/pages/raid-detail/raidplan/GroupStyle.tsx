import type { RaidplanBoard } from "../../../api";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { GROUP_MARKS, GROUP_PALETTE, defaultGroupColor, groupColor, groupMark, setGroupColor, setGroupMark } from "../../../lib/groupStyle";
import { useT } from "../../../i18n";

/**
 * The look of one group: its colour (eight defaults that tell the groups apart, or any colour) and its raid mark (once per board), plus "highlight this
 * group" (the others dim on the map). Shared by the inspector and the group's chip in the Besetzung; the colour never carries the meaning alone: the group
 * number stays visible everywhere.
 */
export default function GroupStyle({ board, n, canWrite, edit, focused, onFocus }: {
    board: RaidplanBoard;
    n: number;
    canWrite: boolean;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, merge?: boolean) => void;
    focused?: boolean;
    onFocus?: () => void;
}) {
    const t = useT();
    const color = groupColor(board.groupColors, n);
    const mark = groupMark(board.groupMarks, n);
    const own = !!(board.groupColors && board.groupColors[String(n)]);
    return (
        <div className="rp-gstyle" role="group" aria-label={t("raidBoard.group.style", { n })}>
            <span className="rp-kicker">{t("raidBoard.group.color")}</span>
            <span className="rp-gswatches">
                {GROUP_PALETTE.map((c, i) => (
                    <button
                        key={c} type="button" disabled={!canWrite} className={`rp-gswatch${color.toLowerCase() === c.toLowerCase() ? " is-on" : ""}`} style={{ background: c }}
                        aria-pressed={color.toLowerCase() === c.toLowerCase()} aria-label={t("raidBoard.group.paletteColor", { n: i + 1 })} onClick={() => edit((b) => setGroupColor(b, n, c === defaultGroupColor(n) ? "" : c))}
                    />
                ))}
                <input type="color" className="rp-color" aria-label={t("raidBoard.group.customColor")} value={color} disabled={!canWrite} onChange={(e) => edit((b) => setGroupColor(b, n, e.target.value), true)} />
                <button type="button" className="rp-link" disabled={!canWrite || !own} onClick={() => edit((b) => setGroupColor(b, n, ""))}>{t("raidBoard.group.resetColor")}</button>
            </span>
            <span className="rp-kicker">{t("raidBoard.group.mark")}</span>
            <span className="rp-gmarks">
                <button type="button" disabled={!canWrite} className={`rp-fchip${mark === "" ? " is-on" : ""}`} aria-pressed={mark === ""} onClick={() => edit((b) => setGroupMark(b, n, ""))}>{t("raidBoard.group.noMark")}</button>
                {GROUP_MARKS.map((m) => (
                    <button
                        key={m} type="button" disabled={!canWrite} className={`rp-fchip rp-gmark${mark === m ? " is-on" : ""}`} aria-pressed={mark === m} aria-label={t(`raidBoard.mark.${m}`)} data-tip={t(`raidBoard.mark.${m}`)}
                        onClick={() => edit((b) => setGroupMark(b, n, m))}
                    >
                        <MarkIcon mark={m as never} size={20} />
                    </button>
                ))}
            </span>
            {onFocus && <button type="button" className={`rp-fchip${focused ? " is-on" : ""}`} aria-pressed={!!focused} onClick={onFocus}>{t("raidBoard.group.focus")}</button>}
        </div>
    );
}
