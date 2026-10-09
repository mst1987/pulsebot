// The Kader's raid roster (#658, docs/kaderplaner.md "Roster aus einem Kader"):
// on the decision page (/kader/<id>/roster) the Kader is linked to exactly one
// roster (`roster.kaderId`, 1:1). Without a link a full admin either creates a
// roster ("Roster anlegen": POST /api/rosters/create with source "kader") or
// links an existing one ("Mit bestehendem Roster verknüpfen": POST
// /api/kader/roster/link - the roster whose category the Kader counts
// attendance in is suggested first, e.g. a migrated "Mo-Raider"). Once linked,
// "Ins Roster übernehmen (n)" (managers of that roster: POST
// /api/kader/roster/sync) takes the players decided since then into THAT
// roster, and "Zum Roster" opens it; a roster running as Loot-Council also
// gets "Zum Loot-Council" (#676, /lootcouncil?roster=<id>, only for a reader
// of the council). Only the state (Roster → Stamm, Bench →
// Ersatz, Tentative → Probe) and the decided character cross; interviews,
// answers, votes and comments stay here. Members already in the roster are
// never touched.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
    createKaderRoster, getKaderRoster, getKaderRosterCategories, linkKaderRoster, syncKaderRoster, updateKader,
    type ApiError, type KaderLinkRoster, type KaderRosterCategory, type KaderRosterState,
} from "../../api";
import { Button, Field, Modal, Switch, buttonClass } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { PlusIcon } from "../../components/ui/icons";
import { useToast } from "../../components/shell/Jobs";
import { useApi } from "../../hooks/useApi";
import { useT } from "../../i18n";
import { countStates } from "../../lib/kader/model";
import { useKader } from "./kaderContext";

/** The refusals the create dialog says in words; anything else shows the server's message. */
const CREATE_CODES = ["category_taken", "kader_not_found", "invalid_name", "name_too_long", "admin_only", "kader_taken"];
/** The refusals of a link in words. */
const LINK_CODES = ["kader_taken", "kader_not_found", "not_found"];

function CreateRosterModal({ kaderId, kaderName, onClose, onCreated }: {
    kaderId: string; kaderName: string; onClose: () => void; onCreated: (rosterId: string, added: number) => void;
}) {
    const t = useT();
    const [name, setName] = useState(kaderName.slice(0, 40));
    const [categoryId, setCategoryId] = useState("");
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const options = useApi(() => getKaderRosterCategories(), []);
    const free: KaderRosterCategory[] = (options.data?.categories || []).filter((c) => !c.rosterId);
    const submit = async () => {
        if (!name.trim() || busy) return;
        setBusy(true);
        setProblem("");
        try {
            const res = await createKaderRoster(kaderId, { name: name.trim(), categoryId });
            onCreated(res.roster.id, res.initial.added);
        } catch (e) {
            const err = e as ApiError;
            setProblem(CREATE_CODES.includes(err.code) ? t(`kader.roster.error.${err.code}`) : err.message || t("kader.error"));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_groupneedmore"
            tone="kader"
            title={t("kader.roster.createTitle")}
            width={520}
            className="kp-dialog"
            initialFocus="input"
            hint={t("kader.roster.createHint")}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon={<PlusIcon />} disabled={!name.trim()} running={busy} onClick={() => void submit()}>{t("kader.roster.create")}</Button>
                </>
            )}
        >
            <div className="kp-stack">
                <Field label={t("kader.field.name")} htmlFor="kp-roster-name">
                    <input id="kp-roster-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
                </Field>
                <Field label={t("kader.roster.category")} htmlFor="kp-roster-cat">
                    <select id="kp-roster-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                        <option value="">{t("kader.roster.noCategory")}</option>
                        {free.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
                    </select>
                </Field>
                <div className="hint">{t("kader.roster.categoryHint")}</div>
                {problem && <p className="kp-livehint" role="alert">{problem}</p>}
            </div>
        </Modal>
    );
}

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
            icon: "inv_misc_groupneedmore",
        });
        if (ok) await send("");
    };
    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_groupneedmore"
            tone="kader"
            title={t("kader.roster.linkTitle")}
            width={520}
            className="kp-dialog"
            hint={t("kader.roster.linkHint")}
            footer={(
                <>
                    {state.roster && <Button variant="ghost" className="kp-foot-left" disabled={busy} onClick={() => void unlink()}>{t("kader.roster.unlink")}</Button>}
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button disabled={!rosterId || rosterId === state.roster?.id || !!picked?.linkedKaderId} running={busy} onClick={() => void send(rosterId)}>{t("kader.roster.link")}</Button>
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
 * The roster action in the decision page's bar: without a link "Mit
 * bestehendem Roster verknüpfen" and "Roster anlegen" (full admins); with one
 * "Ins Roster übernehmen (n)", "Zum Roster" and, for full admins, "Verknüpfung".
 * Nothing for somebody who may do none of it and no roster to show.
 */
export default function RosterLink() {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { kader } = useKader();
    const counts = countStates(kader);
    // the decided players: a state change refetches what is pending
    const decided = `${counts.roster}/${counts.bench}/${counts.tentative}`;
    const state = useApi(() => getKaderRoster(kader.id), [kader.id, decided]);
    const [creating, setCreating] = useState(false);
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
            icon: "inv_misc_groupneedmore",
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

    if (!s.roster) {
        const canLink = !!s.canLink && (s.rosters || []).length > 0;
        if (!s.canCreate && !canLink) return null;
        const suggestion = (s.rosters || []).find((r) => r.suggested && !r.linkedKaderId);
        return (
            <>
                {canLink && (
                    <Button variant="ghost" className="kp-stage-act" onClick={() => setLinking(true)}
                        data-tip={t("kader.roster.linkTip")} data-tip-sub={suggestion ? t("kader.roster.linkTipSuggestion", { name: suggestion.name }) : t("kader.roster.linkTipSub")}>
                        {t("kader.roster.linkButton")}
                    </Button>
                )}
                {s.canCreate && (
                    <Button variant="ghost" icon={<PlusIcon />} className="kp-stage-act" onClick={() => setCreating(true)}
                        data-tip={t("kader.roster.createTip")} data-tip-sub={t("kader.roster.createTipSub", { count: s.candidates })}>
                        {t("kader.roster.createButton")}
                    </Button>
                )}
                {creating && (
                    <CreateRosterModal
                        kaderId={kader.id}
                        kaderName={kader.name}
                        onClose={() => setCreating(false)}
                        onCreated={(_id, added) => {
                            setCreating(false);
                            toast(t("kader.roster.created", { count: added }));
                            void state.reload();
                        }}
                    />
                )}
                {linkModal}
            </>
        );
    }
    return (
        <>
            {s.canSync && s.pending > 0 && (
                <Button variant="ghost" className="kp-stage-act" running={busy} onClick={() => void sync()}
                    data-tip={t("kader.roster.syncTip")} data-tip-sub={t("kader.roster.syncTipSub")}>
                    {t("kader.roster.syncButton", { count: s.pending })}
                </Button>
            )}
            <Link to={`/roster/r/${encodeURIComponent(s.roster.id)}`} className={buttonClass("ghost", "md", false, "kp-stage-act")}
                data-tip={t("kader.roster.openTip", { name: s.roster.name })} data-tip-sub={t("kader.roster.openTipSub", { count: s.roster.members })}>
                {t("kader.roster.open")}
            </Link>
            {/* #676: the roster runs as Loot-Council - only its id crosses, nothing of the Kader */}
            {s.lootCouncil && (
                <Link to={`/lootcouncil?roster=${encodeURIComponent(s.roster.id)}`} className={buttonClass("ghost", "md", false, "kp-stage-act")}
                    data-tip={t("kader.roster.councilTip", { name: s.roster.name })}>
                    {t("kader.roster.council")}
                </Link>
            )}
            {s.canLink && (
                <Button variant="ghost" className="kp-stage-act" onClick={() => setLinking(true)}
                    data-tip={t("kader.roster.relinkTip", { name: s.roster.name })}>
                    {t("kader.roster.relink")}
                </Button>
            )}
            {linkModal}
        </>
    );
}
