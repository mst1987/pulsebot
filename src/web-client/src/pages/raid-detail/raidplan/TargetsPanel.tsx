import { useEffect, useRef } from "react";
import type { RaidplanBoard } from "../../../api";
import { useT } from "../../../i18n";

/**
 * The note of a boss, small on purpose: two lines that grow with the text. (The task rows that
 * used to live here are part of the "Einteilungen" list now, see AssignPanel.)
 */
export default function TargetsPanel({ board, canWrite, maxNotes, onChange }: {
    board: RaidplanBoard;
    canWrite: boolean;
    maxNotes: number;
    onChange: (board: RaidplanBoard) => void;
}) {
    const t = useT();
    const area = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        const el = area.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(220, el.scrollHeight)}px`;
    }, [board.notes]);
    if (!canWrite && !board.notes.trim()) return null;
    return (
        <label className="rp-notes">
            <span className="rp-kicker">{t("raidBoard.targets.notes")}</span>
            <textarea
                ref={area} value={board.notes} maxLength={maxNotes} rows={2} disabled={!canWrite}
                placeholder={t("raidBoard.targets.notesPlaceholder")}
                onChange={(e) => onChange({ ...board, notes: e.target.value })}
            />
        </label>
    );
}
