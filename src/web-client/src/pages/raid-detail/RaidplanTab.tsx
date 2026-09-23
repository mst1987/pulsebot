import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
    getRaidplan, publishRaidplan, saveRaidplan,
    type ApiError, type RaidplanBoard, type RaidplanProfile, type RaidplanView,
} from "../../api";
import PlanBoard, { PlayerName, TokenIcon } from "../../components/raidplan/PlanBoard";
import { Badge, Button, RaidLoader, useConfirm } from "../../components/ui";
import { useToast } from "../../components/Jobs";
import { useT } from "../../i18n";
import {
    applyProfile, boardCount, boardOf, hasContent, nudgeToken, placeToken, profileRows, removeToken, rosterMap, sameBosses, toSave, unplaced, withBoard,
} from "../../lib/raidplan";
import type { RaidCtx } from "./meta";
import TargetsPanel from "./raidplan/TargetsPanel";
import { ProfilePickerModal, ProfilesModal } from "./raidplan/ProfileModals";
import ShareModal from "./raidplan/ShareModal";
import MapModal from "./raidplan/MapModal";
import "../../styles/raidplan.css";

type Bosses = Record<string, Partial<RaidplanBoard>>;
type Drag = { userId: string; fromBoard: boolean; x: number; y: number; ox: number; oy: number; overTray: boolean };

/**
 * Raid-Detail › Raidplan (an own event, docs/raidplan.md): the boss list on the
 * left, the board of the chosen boss in the middle (room map, player tokens),
 * the target rows and the players not placed yet on the right.
 *
 * Tokens are dragged with Pointer Events on window (no HTML5 drag and drop), so a
 * finger works like a mouse: a player from the list onto the board, a token
 * around the board, a token back onto the list to take it off. The arrow keys move
 * a focused token, Delete removes it. Nothing is written until "Speichern", which
 * sends the version that was read — a plan somebody else saved meanwhile is a
 * conflict, never silently overwritten.
 */
export default function RaidplanTab({ ctx }: { ctx: RaidCtx }) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { eventId, csrfToken } = ctx;

    const [view, setView] = useState<RaidplanView | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [draft, setDraft] = useState<Bosses>({});
    const [selected, setSelected] = useState("");
    const [saving, setSaving] = useState(false);
    const [conflict, setConflict] = useState(false);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [modal, setModal] = useState<"" | "pick" | "profiles" | "save" | "share" | "map">("");
    const [profiles, setProfiles] = useState<RaidplanProfile[]>([]);

    const boardRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<Drag | null>(null);
    const selectedRef = useRef("");
    selectedRef.current = selected;

    const load = useCallback(() => {
        setError(null);
        getRaidplan(eventId)
            .then((v) => {
                setView(v);
                setDraft(v.plan.bosses);
                setProfiles(v.profiles);
                setConflict(false);
                setSelected((cur) => (v.bosses.some((b) => b.key === cur) ? cur : (v.bosses[0] && v.bosses[0].key) || ""));
            })
            .catch((err: ApiError) => setError(err));
    }, [eventId]);
    useEffect(load, [load]);

    /** Only the maps (uploads/removals) changed: refresh them without losing the unsaved draft. */
    const reloadMaps = () => {
        getRaidplan(eventId).then((v) => setView((cur) => (cur ? { ...cur, bosses: v.bosses } : v))).catch(() => {});
    };

    const bossKeys = useMemo(() => (view ? view.bosses.map((b) => b.key) : []), [view]);
    const roster = useMemo(() => (view ? view.roster : []), [view]);
    const players = useMemo(() => rosterMap(roster), [roster]);
    const boss = view ? view.bosses.find((b) => b.key === selected) || null : null;
    const board = boardOf(draft, selected);
    const dirty = !!view && !sameBosses(draft, view.plan.bosses, bossKeys);
    const canWrite = !!view && view.canWrite;
    const missing = useMemo(() => unplaced(roster, board), [roster, board]);

    /** Applies a change to the selected boss's board. */
    const editBoard = useCallback((fn: (b: RaidplanBoard) => RaidplanBoard) => {
        setDraft((prev) => withBoard(prev, selectedRef.current, fn(boardOf(prev, selectedRef.current))));
    }, []);

    // ---- dragging (Pointer Events on window) -------------------------------------------------
    const dragging = drag !== null;
    useEffect(() => {
        if (!dragging) return undefined;
        const toBoard = (x: number, y: number) => {
            const rect = boardRef.current ? boardRef.current.getBoundingClientRect() : null;
            if (!rect || !rect.width || !rect.height) return null;
            return { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height, inside: x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom };
        };
        const move = (e: globalThis.PointerEvent) => {
            const d = dragRef.current;
            if (!d) return;
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const next = { ...d, x: e.clientX, y: e.clientY, overTray: !!(el && el.closest("[data-rp-tray]")) };
            dragRef.current = next;
            setDrag(next);
            // A token already on the board follows the pointer live.
            if (d.fromBoard) {
                const p = toBoard(e.clientX + d.ox, e.clientY + d.oy);
                if (p) editBoard((b) => placeToken(b, d.userId, p.x, p.y));
            }
        };
        const up = (e: globalThis.PointerEvent) => {
            const d = dragRef.current;
            dragRef.current = null;
            setDrag(null);
            if (!d) return;
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const overTray = !!(el && el.closest("[data-rp-tray]"));
            if (d.fromBoard) {
                if (overTray) editBoard((b) => removeToken(b, d.userId));
                return;
            }
            const p = toBoard(e.clientX, e.clientY);
            if (p && p.inside) editBoard((b) => placeToken(b, d.userId, p.x, p.y));
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
        };
    }, [dragging, editBoard]);

    const startDrag = (e: PointerEvent<HTMLElement>, userId: string, fromBoard: boolean) => {
        if (!canWrite || e.button !== 0) return;
        e.preventDefault();
        let ox = 0;
        let oy = 0;
        if (fromBoard) {
            // keep the grip: the token does not jump so that its centre sits under the pointer
            const ico = e.currentTarget.getBoundingClientRect();
            ox = ico.left + ico.width / 2 - e.clientX;
            oy = ico.top + ico.height / 2 - e.clientY;
        }
        const d = { userId, fromBoard, x: e.clientX, y: e.clientY, ox, oy, overTray: false };
        dragRef.current = d;
        setDrag(d);
    };

    const onTokenKey = (e: KeyboardEvent<HTMLButtonElement>, userId: string) => {
        if (!canWrite) return;
        const step = e.shiftKey ? 0.05 : 0.01;
        const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[e.key]) {
            e.preventDefault();
            editBoard((b) => nudgeToken(b, userId, moves[e.key][0], moves[e.key][1]));
        } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            editBoard((b) => removeToken(b, userId));
        }
    };

    // ---- save / publish -----------------------------------------------------------------------
    const save = async () => {
        if (!view || saving) return;
        setSaving(true);
        try {
            const v = await saveRaidplan(csrfToken, { event: eventId, version: view.plan.version, bosses: toSave(draft, bossKeys) });
            setView(v);
            setDraft(v.plan.bosses);
            setConflict(false);
            toast(v.dropped ? t("raidBoard.bar.savedDropped", { count: v.dropped }) : t("raidBoard.bar.saved"));
        } catch (err) {
            const e = err as ApiError;
            if (e.code === "conflict") setConflict(true); else toast(e.message, "err");
        } finally {
            setSaving(false);
        }
    };

    const publish = async (published: boolean, rotate = false) => {
        setSaving(true);
        try {
            const v = await publishRaidplan(csrfToken, { event: eventId, published, rotate });
            // Only the publishing state changes here: the unsaved draft stays.
            setView((cur) => (cur ? { ...cur, plan: { ...cur.plan, status: v.plan.status, publicPath: v.plan.publicPath } } : v));
            toast(rotate ? t("raidBoard.share.rotated") : published ? t("raidBoard.share.published") : t("raidBoard.share.unpublished"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    // ---- tactic profiles ----------------------------------------------------------------------
    const pickProfile = async (profile: RaidplanProfile) => {
        if (hasContent(board) && !(await ask({ title: t("raidBoard.profile.applyTitle", { name: profile.name }), text: t("raidBoard.profile.applyText"), action: t("raidBoard.profile.applyAction"), tone: "primary", icon: "inv_scroll_03" }))) return;
        editBoard((b) => applyProfile(b, profile));
        setModal("");
        toast(t("raidBoard.profile.applied", { name: profile.name }));
    };
    const categories = useMemo(() => [...new Set(profiles.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [profiles]);
    const profile = profiles.find((p) => p.id === board.profileId) || null;

    if (error) return <div className="empty">{t("raidDetail.page.loadError", { message: error.message })}</div>;
    if (!view) return <RaidLoader text={t("raidDetail.page.loading")} />;
    if (view.bosses.length === 0) {
        return (
            <div className="rp-empty">
                <strong>{t("raidBoard.noInstance.title")}</strong>
                <p className="rp-muted">{t("raidBoard.noInstance.text")}</p>
            </div>
        );
    }

    const published = view.plan.status === "published";
    const dragPlayer = drag ? players.get(drag.userId) || null : null;

    return (
        <div className="rp-editor">
            <div className="rp-bar">
                <Badge tone={published ? "ok" : undefined}>{published ? t("raidBoard.bar.published") : t("raidBoard.bar.draft")}</Badge>
                {dirty && <Badge tone="mid">{t("raidBoard.bar.dirty")}</Badge>}
                {!canWrite && <Badge>{t("raidBoard.bar.readOnly")}</Badge>}
                <div className="rp-bar-act">
                    {canWrite && <Button variant="ghost" onClick={() => setModal("share")}>{t("raidBoard.bar.share")}</Button>}
                    {canWrite && <Button onClick={save} disabled={!dirty || conflict} running={saving}>{saving ? t("raidBoard.bar.saving") : t("raidBoard.bar.save")}</Button>}
                </div>
            </div>
            {conflict && (
                <div className="flash flash-err rp-conflict">
                    <span>{t("raidBoard.conflict.text")}</span>
                    <Button variant="ghost" size="sm" onClick={load}>{t("raidBoard.conflict.reload")}</Button>
                </div>
            )}
            {canWrite && !view.hasApprovedSetup && (
                <p className="rp-warn">{roster.length === 0 ? t("raidBoard.setupHint.none") : t("raidBoard.setupHint.notApproved")}</p>
            )}

            <div className="rp-layout">
                <nav className="rp-bosses" aria-label={t("raidBoard.bosses.title")}>
                    <h3 className="rp-kicker">{t("raidBoard.bosses.title")}</h3>
                    {view.bosses.map((b, i) => {
                        const n = boardCount(draft, b.key);
                        const tokens = boardOf(draft, b.key).tokens.length;
                        return (
                            <button
                                key={b.key} type="button" className={`rp-boss${b.key === selected ? " is-on" : ""}`}
                                aria-current={b.key === selected ? "true" : undefined}
                                data-tip={n ? t("raidBoard.bosses.count", { tokens, rows: n - tokens }) : undefined}
                                onClick={() => setSelected(b.key)}
                            >
                                <img src={b.iconUrl} alt="" width={26} height={26} loading="lazy" />
                                <span className="rp-boss-name">{i + 1} · {b.name}</span>
                                {n > 0 && <span className="rp-boss-dot" aria-hidden="true" />}
                            </button>
                        );
                    })}
                </nav>

                <div className="rp-center">
                    <div className="rp-toolbar">
                        <h2 className="rp-title">{boss ? boss.name : ""}</h2>
                        {boss && <span className="rp-muted">{boss.instanceName}</span>}
                        {canWrite && boss && (
                            <Button variant="ghost" size="sm" icon="inv_misc_map_01" onClick={() => setModal("map")}>
                                {boss.mapUrl ? t("raidBoard.board.mapReplace") : t("raidBoard.board.mapUpload")}
                            </Button>
                        )}
                    </div>
                    {boss && (
                        <PlanBoard
                            boardRef={boardRef}
                            bossName={boss.name}
                            bossIcon={boss.iconUrl}
                            mapUrl={boss.mapUrl}
                            tokens={board.tokens}
                            players={players}
                            dragId={drag && drag.fromBoard ? drag.userId : ""}
                            onTokenDown={canWrite ? (e, id) => startDrag(e, id, true) : undefined}
                            onTokenKey={canWrite ? onTokenKey : undefined}
                            emptyText={canWrite ? `${t("raidBoard.board.noMapTitle")} · ${t("raidBoard.board.noMapText")}` : t("raidBoard.board.noMapTitle")}
                        />
                    )}
                    {canWrite && <p className="rp-muted rp-hint">{t("raidBoard.board.hint")}</p>}
                </div>

                <aside className="rp-side">
                    <TargetsPanel
                        board={board}
                        roster={roster}
                        canWrite={canWrite}
                        maxRows={view.limits.targetsPerBoss}
                        maxTitle={view.limits.title}
                        maxNotes={view.limits.notes}
                        profileName={profile ? profile.name : ""}
                        onChange={(b) => editBoard(() => b)}
                        onPickProfile={() => setModal("pick")}
                    />
                    <section className={`rp-side-block rp-tray${drag && drag.overTray ? " is-over" : ""}`} data-rp-tray>
                        <h3 className="rp-kicker">{t("raidBoard.tray.title")} · {missing.length}</h3>
                        {roster.length === 0 && <p className="rp-muted">{t("raidBoard.tray.none")}</p>}
                        {roster.length > 0 && missing.length === 0 && <p className="rp-muted">{t("raidBoard.tray.empty")}</p>}
                        <div className="rp-tray-list">
                            {missing.map((p) => (
                                <span
                                    key={p.userId}
                                    className={`rp-chip${canWrite ? " is-drag" : ""}`}
                                    data-tip={`${p.specLabel} ${p.className}`.trim()}
                                    onPointerDown={canWrite ? (e) => startDrag(e, p.userId, false) : undefined}
                                >
                                    <TokenIcon player={p} size="sm" />
                                    <PlayerName player={p} />
                                </span>
                            ))}
                        </div>
                    </section>
                </aside>
            </div>

            {drag && !drag.fromBoard && dragPlayer && (
                <div className="rp-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
                    <TokenIcon player={dragPlayer} />
                </div>
            )}

            <ProfilePickerModal
                open={modal === "pick"} onClose={() => setModal("")} profiles={profiles} bosses={view.bosses} bossKey={selected}
                currentId={board.profileId} onPick={pickProfile}
                onSaveAs={() => setModal(profileRows(board).length ? "save" : "profiles")}
                onManage={() => setModal("profiles")}
            />
            <ProfilesModal
                open={modal === "profiles" || modal === "save"} onClose={() => setModal("")} csrfToken={csrfToken}
                profiles={profiles} categories={categories} bosses={view.bosses} bossKey={selected}
                draft={modal === "save" ? board : null} limits={view.limits}
                onChanged={(list, saved) => {
                    setProfiles(list);
                    // "Als Taktik speichern": the board now belongs to the profile it was saved as.
                    if (saved && modal === "save") editBoard((b) => ({ ...b, profileId: saved.id }));
                }}
            />
            <ShareModal
                open={modal === "share"} onClose={() => setModal("")} published={published} publicPath={view.plan.publicPath}
                dirty={dirty} hasApprovedSetup={view.hasApprovedSetup} busy={saving}
                onPublish={(p) => publish(p)} onRotate={() => publish(true, true)}
            />
            <MapModal
                open={modal === "map"} onClose={() => setModal("")} csrfToken={csrfToken} boss={boss}
                instanceHasMap={!!boss && boss.instanceMap} onChanged={reloadMaps}
            />
        </div>
    );
}
