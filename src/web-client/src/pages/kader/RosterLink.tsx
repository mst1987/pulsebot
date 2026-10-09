// The Kader's raid roster (#658, docs/kaderplaner.md "Roster aus einem Kader"):
// on the decision page (/kader/<id>/roster) the Kader either creates a roster
// ("Roster anlegen", full admins: POST /api/rosters/create with source "kader")
// or, once it has one, takes the players decided since then over ("Ins Roster
// übernehmen", managers of that roster: POST /api/kader/roster/sync). Only the
// state (Roster → Stamm, Bench → Ersatz, Tentative → Probe) and the decided
// character cross; interviews, answers, votes and comments stay here. Members
// already in the roster are never touched — afterwards everything is edited on
// the roster page ("Zum Roster").
import { useState } from "react";
import { Link } from "react-router-dom";
import {
    createKaderRoster, getKaderRoster, getKaderRosterCategories, syncKaderRoster, type ApiError, type KaderRosterCategory,
} from "../../api";
import { Button, Field, Modal, buttonClass } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { PlusIcon } from "../../components/ui/icons";
import { useToast } from "../../components/shell/Jobs";
import { useApi } from "../../hooks/useApi";
import { useT } from "../../i18n";
import { countStates } from "../../lib/kader/model";
import { useKader } from "./kaderContext";

/** The refusals the create dialog says in words; anything else shows the server's message. */
const CREATE_CODES = ["category_taken", "kader_not_found", "invalid_name", "name_too_long", "admin_only"];

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

/**
 * The roster action in the decision page's bar: "Roster anlegen", or "Ins
 * Roster übernehmen (n)" plus "Zum Roster" once the Kader has one. Nothing for
 * somebody who may do neither and no roster to show.
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

    if (!s.roster) {
        if (!s.canCreate) return null;
        return (
            <>
                <Button variant="ghost" icon={<PlusIcon />} className="kp-stage-act" onClick={() => setCreating(true)}
                    data-tip={t("kader.roster.createTip")} data-tip-sub={t("kader.roster.createTipSub", { count: s.candidates })}>
                    {t("kader.roster.createButton")}
                </Button>
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
        </>
    );
}
