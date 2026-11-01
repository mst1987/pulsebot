// The Kader's raid roster and the actions around it (#658, docs/kaderplaner.md
// "Roster aus einem Kader"): the "Roster" group of the status bar, on the decision
// and the composition page. The Kader is linked to exactly one roster
// (`roster.kaderId`, 1:1). The green button (TakeoverWizard.tsx) creates a roster
// or takes the Kader into Discord; next to it the menu "Mehr" holds the smaller
// ways: without a roster "Mit bestehendem Roster verknüpfen" (POST
// /api/kader/roster/link - the roster whose category the Kader counts attendance
// in is suggested first, e.g. a migrated "Mo-Raider"), with one "Zum Loot-Council"
// (#676, /lootcouncil?roster=<id>, only for a reader of the council) and
// "Verknüpfung". Once linked, "Ins Roster übernehmen (n)" (managers of that roster:
// POST /api/kader/roster/sync) takes the players decided since then into THAT
// roster, and "Zum Roster" opens it. Only the state (Roster → Stamm, Bench → Ersatz,
// Tentative → Probe) and the decided character cross; interviews, answers, votes
// and comments stay here. Members already in the roster are never touched.
// After a takeover sync and link are gone: there "Rolle nachziehen" brings everybody
// in as Stamm (a sync would map differently) and the server refuses another link.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
    getKaderRoster, linkKaderRoster, syncKaderRoster, updateKader,
    type ApiError, type KaderLinkRoster, type KaderRosterState,
} from "../../api";
import { Button, Field, Modal, Switch, buttonClass } from "../../components/ui";
import { useConfirm } from "../../components/ui/overlay/Modal";
import { ChevronDownIcon, LinkIcon } from "../../components/ui/icons/icons";
import { useToast } from "../../components/shell/Jobs";
import { useDismiss } from "../../hooks/useDismiss";
import { useApi } from "../../hooks/useApi";
import { useT } from "../../i18n";
import { countStates } from "../../lib/kader/model";
import { TakeoverEntry } from "./modals/TakeoverWizard";
import { useKader } from "./kaderContext";

/** The refusals of a link in words. */
const LINK_CODES = ["kader_taken", "kader_not_found", "not_found", "version_mismatch", "kader_taken_over"];

/** One roster as the link picker names it: "Mo-Raider (Vorschlag)", "PuG · verknüpft mit einem anderen Kader". */
function rosterOption(r: KaderLinkRoster, t: ReturnType<typeof useT>): string {
    if (r.linkedKaderId) return t("kader.roster.linkTaken", { name: r.name });
    return r.suggested ? t("kader.roster.linkSuggested", { name: r.name }) : r.name;
}

/**
 * "Mit bestehendem Roster verknüpfen": pick a roster of the server (the
 * suggestion first), optionally count its category in the Kader's attendance,
 * link. With a link already there it also offers to unlink.
 */
function LinkRosterModal({ state, onClose, onLinked }: { state: KaderRosterState; onClose: () => void; onLinked: (next: KaderRosterState) => void }) {
    const t = useT();
    const ask = useConfirm();
    const { kader, run } = useKader();
    const rosters = state.rosters || [];
    const first = state.roster?.id || rosters.find((r) => r.suggested && !r.linkedKaderId)?.id || rosters.find((r) => !r.linkedKaderId)?.id || "";
    const [rosterId, setRosterId] = useState(first);
    const [countCategory, setCountCategory] = useState(true);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const picked = rosters.find((r) => r.id === rosterId) || null;
    const counted = kader.attendanceCategories || [];
    const offerCategory = !!picked && !!picked.categoryId && !counted.includes(picked.categoryId);

    const send = async (target: string) => {
        setBusy(true);
        setProblem("");
        try {
            const next = await linkKaderRoster(kader.id, target);
            if (target && offerCategory && countCategory && picked?.categoryId) {
                await run(updateKader(kader.id, { attendanceCategories: [...counted, picked.categoryId] }));
            }
            onLinked(next);
        } catch (e) {
            const err = e as ApiError;
            setProblem(LINK_CODES.includes(err.code) ? t(`kader.roster.error.${err.code}`) : err.message || t("kader.error"));
        } finally {
            setBusy(false);
        }
    };
    const unlink = async () => {
        if (!state.roster) return;
        const ok = await ask({
            title: t("kader.roster.unlinkTitle", { name: state.roster.name }),
            text: t("kader.roster.unlinkText"),
            action: t("kader.roster.unlink"),
            tone: "primary",
            icon: "kader",
        });
        if (ok) await send("");
    };
    return (
        <Modal
            open
            onClose={onClose}
            icon="kader"
            tone="kader"
            title={t("kader.roster.linkTitle")}
            width={520}
            className="kp-dialog"
            hint={t("kader.roster.linkHint")}
            footer={(
                <>
                    {state.roster && <Button variant="ghost" className="kp-foot-left" disabled={busy} onClick={() => void unlink()}>{t("kader.roster.unlink")}</Button>}
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button variant="go" icon={<LinkIcon />} disabled={!rosterId || rosterId === state.roster?.id || !!picked?.linkedKaderId} running={busy} onClick={() => void send(rosterId)}>{t("kader.roster.link")}</Button>
                </>
            )}
        >
            <div className="kp-stack">
                <Field label={t("kader.roster.linkPick")} htmlFor="kp-roster-link">
                    <select id="kp-roster-link" value={rosterId} onChange={(e) => setRosterId(e.target.value)}>
                        {!rosters.length && <option value="">{t("kader.roster.linkNone")}</option>}
                        {rosters.map((r) => <option key={r.id} value={r.id} disabled={!!r.linkedKaderId}>{rosterOption(r, t)}</option>)}
                    </select>
                </Field>
                <div className="hint">{t("kader.roster.linkPickHint")}</div>
                {offerCategory && (
                    <Switch checked={countCategory} onChange={setCountCategory} label={t("kader.roster.linkCountCategory")} tip={t("kader.roster.linkCountCategoryTip")} />
                )}
                {problem && <p className="kp-livehint" role="alert">{problem}</p>}
            </div>
        </Modal>
    );
}

/**
 * The smaller roster actions behind one button, right next to the green one:
 * arrows walk the entries, Escape and a click elsewhere close (focus back on the button).
 */
function RosterMenu({ children }: { children: (close: () => void) => ReactNode }) {
    const t = useT();
    const [shown, setShown] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);
    const btn = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const close = () => setShown(false);
    useDismiss(wrap, shown, close);
    useEffect(() => {
        if (shown) menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    }, [shown]);
    const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            close();
            btn.current?.focus();
            return;
        }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") || []);
        const at = items.indexOf(document.activeElement as HTMLElement);
        items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    };
    return (
        <div className="kp-menuwrap kp-rostermenu" ref={wrap} onKeyDown={onKey}>
            <button ref={btn} type="button" className={buttonClass("ghost", "md", false, "kp-stage-act")} aria-haspopup="menu" aria-expanded={shown} onClick={() => setShown(!shown)}>
                {t("kader.nav.more")}<ChevronDownIcon />
            </button>
            {shown && <div className="kp-menu" ref={menu} role="menu" aria-label={t("kader.nav.more")}>{children(close)}</div>}
        </div>
    );
}

/**
 * The bar's "Roster" group: the sync when players wait, "Zum Roster", the menu of
 * the smaller ways and the green button far right. Nothing for a reader without a
 * roster to show.
 */
export default function RosterLink() {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { kader, canWrite } = useKader();
    const counts = countStates(kader);
    // the decided players: a state change refetches what is pending
    const decided = `${counts.roster}/${counts.bench}/${counts.tentative}`;
    const state = useApi(() => getKaderRoster(kader.id), [kader.id, decided]);
    const [linking, setLinking] = useState(false);
    const [busy, setBusy] = useState(false);
    const s = state.data;
    if (!s) return null;

    const sync = async () => {
        if (!s.roster) return;
        const ok = await ask({
            title: t("kader.roster.syncTitle", { name: s.roster.name }),
            text: t("kader.roster.syncText", { count: s.pending }),
            action: t("kader.roster.sync"),
            // nothing is lost: an ordinary confirmation, no trash icon
            tone: "primary",
            icon: "kader",
        });
        if (!ok) return;
        setBusy(true);
        try {
            const res = await syncKaderRoster(kader.id);
            toast(t("kader.roster.synced", { count: res.added }) + (res.roleFailures.length ? ` ${t("kader.roster.roleFailures", { count: res.roleFailures.length })}` : ""),
                res.roleFailures.length ? "err" : undefined);
            await state.reload();
        } catch (e) {
            toast((e as ApiError).message || t("kader.error"), "err");
        } finally {
            setBusy(false);
        }
    };

    const linkModal = linking && (
        <LinkRosterModal
            state={s}
            onClose={() => setLinking(false)}
            onLinked={(next) => {
                setLinking(false);
                toast(next.roster ? t("kader.roster.linked", { name: next.roster.name }) : t("kader.roster.unlinked"));
                state.setData(next);
            }}
        />
    );

    const roster = s.roster;
    const taken = !!kader.takeover;
    // only with a free choice: without a roster to pick the entry leads nowhere
    const canLinkNew = !roster && !!s.canLink && (s.rosters || []).length > 0;
    const canRelink = !!roster && !!s.canLink && !taken;
    const council = !!roster && !!s.lootCouncil;
    if (!roster && !canWrite && !canLinkNew) return null;
    const suggestion = (s.rosters || []).find((r) => r.suggested && !r.linkedKaderId);
    const hasMenu = canLinkNew || canRelink || council;
    return (
        <div className="kp-navgroup kp-navgroup-main">
            <span className="kicker">{t("kader.nav.rosterGroup")}</span>
            <div className="kp-navrow kp-navrow-acts">
                {roster && !taken && s.canSync && s.pending > 0 && (
                    <Button variant="ghost" className="kp-stage-act" running={busy} onClick={() => void sync()}
                        data-tip={t("kader.roster.syncTip")} data-tip-sub={t("kader.roster.syncTipSub")}>
                        {t("kader.roster.syncButton", { count: s.pending })}
                    </Button>
                )}
                {roster && (
                    <Link to={`/roster/r/${encodeURIComponent(roster.id)}`} className={buttonClass("ghost", "md", false, "kp-stage-act")}
                        data-tip={t("kader.roster.openTip", { name: roster.name })} data-tip-sub={t("kader.roster.openTipSub", { count: roster.members })}>
                        {t("kader.roster.open")}
                    </Link>
                )}
                {hasMenu && (
                    <RosterMenu>
                        {(close) => (
                            <>
                                {canLinkNew && (
                                    <button type="button" role="menuitem" className="kp-menuopt" onClick={() => { close(); setLinking(true); }}
                                        data-tip={t("kader.roster.linkTip")} data-tip-sub={suggestion ? t("kader.roster.linkTipSuggestion", { name: suggestion.name }) : t("kader.roster.linkTipSub")}>
                                        {t("kader.roster.linkButton")}
                                    </button>
                                )}
                                {/* #676: the roster runs as Loot-Council - only its id crosses, nothing of the Kader */}
                                {roster && council && (
                                    <Link role="menuitem" to={`/lootcouncil?roster=${encodeURIComponent(roster.id)}`} className="kp-menuopt" onClick={close}
                                        data-tip={t("kader.roster.councilTip", { name: roster.name })}>
                                        {t("kader.roster.council")}
                                    </Link>
                                )}
                                {roster && canRelink && (
                                    <button type="button" role="menuitem" className="kp-menuopt" onClick={() => { close(); setLinking(true); }}
                                        data-tip={t("kader.roster.relinkTip", { name: roster.name })}>
                                        {t("kader.roster.relink")}
                                    </button>
                                )}
                            </>
                        )}
                    </RosterMenu>
                )}
                <TakeoverEntry canCreate={!!s.canCreate} linked={!!roster} onDone={state.reload} />
            </div>
            {linkModal}
        </div>
    );
}
