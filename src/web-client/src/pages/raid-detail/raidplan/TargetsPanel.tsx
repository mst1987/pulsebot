import { useState } from "react";
import type { RaidplanBoard, RaidplanPlayer } from "../../../api";
import { Button, IconButton, Modal } from "../../../components/ui";
import { PlusIcon } from "./icons";
import { TrashIcon, XIcon } from "../../../components/icons";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { newTarget, removeTarget, toggleAssignee, updateTarget } from "../../../lib/raidplan";
import { useT } from "../../../i18n";

/**
 * The right column of a boss: the tactic picker, the target rows with their
 * players, and the note. A row is only a title and the players standing on it;
 * what a title means is the orga's business (nothing is pre-filled). Who may be
 * assigned comes from the roster (the setup), never typed in.
 */
export default function TargetsPanel({ board, roster, canWrite, maxRows, maxTitle, maxNotes, profileName, onChange, onPickProfile }: {
    board: RaidplanBoard;
    roster: RaidplanPlayer[];
    canWrite: boolean;
    maxRows: number;
    maxTitle: number;
    maxNotes: number;
    profileName: string;
    onChange: (board: RaidplanBoard) => void;
    onPickProfile: () => void;
}) {
    const t = useT();
    const [assigning, setAssigning] = useState("");
    const [query, setQuery] = useState("");
    const byId = new Map(roster.map((p) => [p.userId, p]));
    const row = board.targets.find((r) => r.id === assigning) || null;
    const full = board.targets.length >= maxRows;
    const q = query.trim().toLowerCase();
    const candidates = roster.filter((p) => !q || `${p.character} ${p.className} ${p.specLabel}`.toLowerCase().includes(q));

    return (
        <section className="rp-side-block">
            <div className="rp-side-head">
                <h3 className="rp-kicker">{t("raidBoard.targets.title")}</h3>
                {canWrite && (
                    <Button variant="ghost" size="sm" onClick={onPickProfile} className="rp-tactic-btn">
                        {profileName ? t("raidBoard.profile.current", { name: profileName }) : t("raidBoard.profile.pick")}
                    </Button>
                )}
            </div>
            {!canWrite && profileName && <p className="rp-muted">{t("raidBoard.profile.current", { name: profileName })}</p>}

            {board.targets.length === 0 && <p className="rp-muted">{t("raidBoard.targets.empty")}</p>}
            <ul className="rp-rows">
                {board.targets.map((r) => (
                    <li key={r.id} className="rp-row">
                        <div className="rp-row-head">
                            <input
                                className="rp-row-title"
                                value={r.title}
                                maxLength={maxTitle}
                                placeholder={t("raidBoard.targets.titlePlaceholder")}
                                disabled={!canWrite}
                                aria-label={t("raidBoard.targets.titlePlaceholder")}
                                onChange={(e) => onChange(updateTarget(board, r.id, { title: e.target.value }))}
                            />
                            {canWrite && (
                                <IconButton icon={<TrashIcon />} tip={t("raidBoard.targets.remove")} size="sm" onClick={() => onChange(removeTarget(board, r.id))} />
                            )}
                        </div>
                        <div className="rp-row-people">
                            {r.userIds.length === 0 && !canWrite && <span className="rp-muted">{t("raidBoard.targets.noOne")}</span>}
                            {r.userIds.map((id) => {
                                const p = byId.get(id);
                                if (!p) return null;
                                return (
                                    <span key={id} className="rp-chip rp-static">
                                        <TokenIcon player={p} size="sm" />
                                        <PlayerName player={p} />
                                        {canWrite && (
                                            <button
                                                type="button"
                                                className="rp-chip-x"
                                                aria-label={t("raidBoard.targets.unassign", { name: p.character })}
                                                onClick={() => onChange(toggleAssignee(board, r.id, id))}
                                            >
                                                <XIcon />
                                            </button>
                                        )}
                                    </span>
                                );
                            })}
                            {canWrite && (
                                <button type="button" className="rp-chip rp-chip-add" onClick={() => { setQuery(""); setAssigning(r.id); }}>
                                    <PlusIcon /> {t("raidBoard.targets.assign")}
                                </button>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
            {canWrite && (
                <button
                    type="button"
                    className="rp-add"
                    disabled={full}
                    data-tip={full ? t("raidBoard.targets.rowsFull", { max: maxRows }) : undefined}
                    onClick={() => onChange({ ...board, targets: [...board.targets, newTarget("")] })}
                >
                    <PlusIcon /> {t("raidBoard.targets.add")}
                </button>
            )}

            <label className="rp-notes">
                <span className="rp-kicker">{t("raidBoard.targets.notes")}</span>
                <textarea
                    value={board.notes}
                    maxLength={maxNotes}
                    rows={3}
                    disabled={!canWrite}
                    placeholder={t("raidBoard.targets.notesPlaceholder")}
                    onChange={(e) => onChange({ ...board, notes: e.target.value })}
                />
            </label>

            <Modal open={!!row} onClose={() => setAssigning("")} icon="inv_misc_note_02" title={t("raidBoard.targets.assignTitle", { row: (row && row.title) || t("raidBoard.targets.newRow") })} width={480} initialFocus=".rp-search">
                <input className="rp-search" value={query} placeholder={t("raidBoard.targets.assignSearch")} onChange={(e) => setQuery(e.target.value)} />
                <ul className="rp-pick">
                    {candidates.map((p) => {
                        const on = !!row && row.userIds.includes(p.userId);
                        return (
                            <li key={p.userId}>
                                <button type="button" className={`rp-pick-row${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => row && onChange(toggleAssignee(board, row.id, p.userId))}>
                                    <TokenIcon player={p} size="sm" />
                                    <PlayerName player={p} />
                                    <span className="rp-muted">{[p.specLabel, p.className].filter(Boolean).join(" ")}</span>
                                    {on && <span className="rp-pick-check" aria-hidden="true">✓</span>}
                                </button>
                            </li>
                        );
                    })}
                    {candidates.length === 0 && <li className="rp-muted">{t("raidBoard.targets.assignNone")}</li>}
                </ul>
            </Modal>
        </section>
    );
}
