// "Profile" (#676, before: "Gewichtung", #668): the Loot-Council profiles - a
// named set of council settings a roster with loot system Loot-Council uses.
// Left the list (name, how many rosters use it), right the picked profile:
// its view (role, Content, BiS list - what the page and the addon filter by)
// and its weighting (stores/councilProfilesStore.js). One primary action,
// "Speichern"; "Neues Profil", "Umbenennen", "Kopieren" and "Löschen" are
// quiet buttons. A profile a roster or category still uses cannot be deleted.
// Writing takes `lootcouncil` write; a reader sees everything without controls.
import { useMemo, useState } from "react";
import {
    createCouncilProfile, deleteCouncilProfile, getCouncilProfile, getCouncilProfiles, updateCouncilProfile,
    type ApiError, type CouncilCategoryView, type CouncilFilterOptions, type CouncilProfileData, type CouncilProfileRow, type CouncilWeightSettings,
} from "../../api";
import { AsyncView, Badge, Button, Field, Modal, Segment, useConfirm } from "../../components/ui";
import { PlusIcon, TrashIcon } from "../../components/ui/icons";
import RaidLoader from "../../components/ui/RaidLoader";
import { useJobs, useToast } from "../../components/shell/Jobs";
import { useApi } from "../../hooks/useApi";
import { useT } from "../../i18n";
import { Part } from "./Part";
import { ROLE_ICON, roleLabel } from "./council";
import { Section, WeightsEditor } from "./WeightsEditor";
import { cloneView, cloneWeights, sameView, sameWeights } from "./profiles";

/** The refusals the tab says in words; anything else shows the server's message. */
const CODES = ["name_taken", "invalid_name", "name_too_long", "profile_in_use", "profile_default", "profile_limit", "not_found"];

const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

type Props = {
    /** The profile of the council the page shows - picked first. */
    initialId: string;
    /** Roles, tiers, raids and BiS lists for the view section. */
    options: CouncilFilterOptions;
    canWrite: boolean;
    /** After a change the council's numbers change - the page reloads them. */
    onSaved: () => void;
};

/** "Name" dialog for a new profile, a copy or a rename. */
function NameDialog({ title, initial, action, onClose, onSubmit }: {
    title: string; initial: string; action: string; onClose: () => void; onSubmit: (name: string) => Promise<string | null>;
}) {
    const t = useT();
    const [name, setName] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const submit = async () => {
        if (!name.trim() || busy) return;
        setBusy(true);
        const error = await onSubmit(name.trim());
        setBusy(false);
        if (error) setProblem(error);
    };
    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_note_01"
            tone="lootcouncil"
            title={title}
            width={460}
            initialFocus="input"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button disabled={!name.trim()} running={busy} onClick={() => void submit()}>{action}</Button>
                </>
            )}
        >
            <Field label={t("lootcouncil.profiles.name")} htmlFor="lc-profile-name" hint={t("lootcouncil.profiles.nameHint")} error={problem || undefined}>
                <input id="lc-profile-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
            </Field>
        </Modal>
    );
}

/** "von 2 Rostern genutzt" - or the categories, or nobody. */
function usageText(row: CouncilProfileRow, t: ReturnType<typeof useT>): string {
    if (row.rosters.length) return t("lootcouncil.profiles.usedBy", { count: row.rosters.length });
    if (row.categories.length) return t("lootcouncil.profiles.usedByCategories", { count: row.categories.length });
    return row.isDefault ? t("lootcouncil.profiles.usedByNone") : t("lootcouncil.profiles.unused");
}

export function ProfilesTab(props: Props) {
    const t = useT();
    const list = useApi(() => getCouncilProfiles(), []);
    const [selected, setSelected] = useState(props.initialId);
    const rows = list.data?.profiles || [];
    // a picked profile that is gone (deleted) falls back to the default
    const current = rows.find((p) => p.id === selected) || rows.find((p) => p.isDefault) || null;
    const currentId = current ? current.id : selected;
    return (
        <Part icon="inv_misc_coin_17" title={t("lootcouncil.profiles.title")} hint={t("lootcouncil.profiles.hint")}>
            <AsyncView state={list} loading={<RaidLoader text={t("lootcouncil.profiles.loading")} />}>
                {(data) => (
                    <div className="lc-profiles">
                        <ProfileList
                            rows={data.profiles}
                            selected={currentId}
                            canWrite={props.canWrite}
                            onPick={setSelected}
                            onCreated={(id) => { setSelected(id); void list.reload(); }}
                        />
                        {current ? (
                            <ProfileDetail
                                key={current.id}
                                row={current}
                                {...props}
                                onChanged={() => { void list.reload(); props.onSaved(); }}
                                onCopied={(id) => { setSelected(id); void list.reload(); }}
                                onDeleted={() => { setSelected(data.defaultId); void list.reload(); props.onSaved(); }}
                            />
                        ) : null}
                    </div>
                )}
            </AsyncView>
        </Part>
    );
}

function ProfileList({ rows, selected, canWrite, onPick, onCreated }: {
    rows: CouncilProfileRow[]; selected: string; canWrite: boolean; onPick: (id: string) => void; onCreated: (id: string) => void;
}) {
    const t = useT();
    const toast = useToast();
    const [creating, setCreating] = useState(false);
    return (
        <aside className="lc-plist" aria-label={t("lootcouncil.profiles.listLabel")}>
            <div className="lc-plist-head">
                <h3>{t("lootcouncil.profiles.listTitle", { count: rows.length })}</h3>
                {canWrite ? <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={() => setCreating(true)}>{t("lootcouncil.profiles.create")}</Button> : null}
            </div>
            <ul>
                {rows.map((p) => (
                    <li key={p.id}>
                        <button type="button" className={`lc-pitem${p.id === selected ? " on" : ""}`} aria-pressed={p.id === selected} onClick={() => onPick(p.id)}>
                            <span className="lc-pitem-name">{p.name}{p.isDefault ? <Badge size="sm">{t("lootcouncil.profiles.default")}</Badge> : null}</span>
                            <span className="lc-muted">{usageText(p, t)}</span>
                        </button>
                    </li>
                ))}
            </ul>
            {creating ? (
                <NameDialog
                    title={t("lootcouncil.profiles.createTitle")}
                    initial=""
                    action={t("lootcouncil.profiles.createAction")}
                    onClose={() => setCreating(false)}
                    onSubmit={async (name) => {
                        try {
                            const res = await createCouncilProfile(name);
                            setCreating(false);
                            toast(t("lootcouncil.profiles.created", { name: res.profile.name }));
                            onCreated(res.profile.id);
                            return null;
                        } catch (e) {
                            const err = e as ApiError;
                            return CODES.includes(err.code) ? t(`lootcouncil.profiles.err.${err.code}`) : err.message;
                        }
                    }}
                />
            ) : null}
        </aside>
    );
}

function ProfileDetail({ row, options, canWrite, onChanged, onCopied, onDeleted }: Props & {
    row: CouncilProfileRow; onChanged: () => void; onCopied: (id: string) => void; onDeleted: () => void;
}) {
    const t = useT();
    const detail = useApi(() => getCouncilProfile(row.id), [row.id]);
    return (
        <AsyncView state={detail} loading={<RaidLoader compact text={t("lootcouncil.profiles.loading")} />}>
            {(data) => (
                <ProfileForm
                    key={`${data.profile.id}:${data.profile.weights.at || 0}`}
                    row={row}
                    data={data}
                    options={options}
                    canWrite={canWrite}
                    onStored={(fresh) => { detail.setData(fresh); onChanged(); }}
                    onCopied={onCopied}
                    onDeleted={onDeleted}
                />
            )}
        </AsyncView>
    );
}

function ProfileForm({ row, data, options, canWrite, onStored, onCopied, onDeleted }: {
    row: CouncilProfileRow;
    data: CouncilProfileData;
    options: CouncilFilterOptions;
    canWrite: boolean;
    onStored: (fresh: CouncilProfileData) => void;
    onCopied: (id: string) => void;
    onDeleted: () => void;
}) {
    const t = useT();
    const ask = useConfirm();
    const jobs = useJobs();
    const toast = useToast();
    const [weights, setWeights] = useState<CouncilWeightSettings>(() => cloneWeights(data.profile.weights));
    const [view, setView] = useState<CouncilCategoryView>(() => cloneView(data.profile.view));
    const [saving, setSaving] = useState(false);
    const [naming, setNaming] = useState<"rename" | "copy" | null>(null);
    const ro = !canWrite;
    const dirty = useMemo(() => !sameWeights(weights, data.profile.weights) || !sameView(view, data.profile.view), [weights, view, data]);

    const fail = (e: unknown) => {
        const err = e as ApiError;
        toast(CODES.includes(err.code) ? t(`lootcouncil.profiles.err.${err.code}`) : (err.message || t("lootcouncil.page.actionFailed")), "err");
    };

    const save = async () => {
        setSaving(true);
        try {
            const fresh = await jobs.run({ label: t("lootcouncil.profiles.saving"), quiet: true }, () => updateCouncilProfile(data.profile.id, { weights, view }));
            if (!fresh) return;
            toast(t("lootcouncil.profiles.saved", { name: fresh.profile.name }));
            onStored(fresh);
        } finally {
            setSaving(false);
        }
    };

    const toDefaults = async () => {
        const ok = await ask({
            title: t("lootcouncil.weights.resetTitle"),
            text: t("lootcouncil.weights.resetText"),
            action: t("lootcouncil.weights.reset"),
            icon: "spell_holy_borrowedtime",
        });
        if (ok) {
            setWeights(cloneWeights(data.defaults.weights));
            setView(cloneView(data.defaults.view));
        }
    };

    const remove = async () => {
        const ok = await ask({
            title: t("lootcouncil.profiles.deleteTitle", { name: row.name }),
            text: t("lootcouncil.profiles.deleteText"),
            action: t("lootcouncil.profiles.delete"),
            tone: "danger",
        });
        if (!ok) return;
        try {
            await deleteCouncilProfile(row.id);
            toast(t("lootcouncil.profiles.deleted", { name: row.name }));
            onDeleted();
        } catch (e) {
            fail(e);
        }
    };

    const users = [...row.rosters, ...row.otherRosters].map((r) => r.name);
    const deleteTip = row.isDefault ? t("lootcouncil.profiles.err.profile_default") : row.inUse ? t("lootcouncil.profiles.inUseTip", { names: [...users, ...row.categories.map((c) => c.name)].join(", ") }) : undefined;
    const o = options;

    return (
        <div className="lc-peditor">
            <div className="lc-peditor-head">
                <div>
                    <h3>{data.profile.name}{data.profile.isDefault ? <Badge size="sm">{t("lootcouncil.profiles.default")}</Badge> : null}</h3>
                    <p className="lc-muted">
                        {users.length ? t("lootcouncil.profiles.usedByNames", { names: users.join(", ") }) : usageText(row, t)}
                    </p>
                </div>
                {canWrite ? (
                    <div className="lc-peditor-acts">
                        <Button variant="ghost" size="sm" onClick={() => setNaming("rename")}>{t("lootcouncil.profiles.rename")}</Button>
                        <Button variant="ghost" size="sm" onClick={() => setNaming("copy")}>{t("lootcouncil.profiles.copy")}</Button>
                        <span data-tip={deleteTip}>
                            <Button variant="ghost" size="sm" icon={<TrashIcon />} disabled={row.inUse} onClick={() => void remove()}>{t("lootcouncil.profiles.delete")}</Button>
                        </span>
                    </div>
                ) : null}
            </div>
            {ro ? <Badge tone="mid">{t("lootcouncil.weights.readOnly")}</Badge> : null}

            <div className="lc-weights">
                <Section title={t("lootcouncil.profiles.viewTitle")} sub={t("lootcouncil.profiles.viewSub")}>
                    <div className="lc-pview">
                        <div className="lc-field">
                            <span className="kicker">{t("lootcouncil.filter.role")}</span>
                            <Segment
                                ariaLabel={t("lootcouncil.profiles.viewRole")}
                                value={view.role}
                                onChange={(role) => { if (!ro) setView({ ...view, role }); }}
                                options={[
                                    ...o.roles.map((r) => ({ value: r.id, label: roleLabel(r.id, r.label), icon: ROLE_ICON[r.id], disabled: ro })),
                                    { value: "", label: t("common.all"), disabled: ro },
                                ]}
                            />
                        </div>
                        <div className="lc-field" role="group" aria-label={t("lootcouncil.filter.chooseContent")}>
                            <span className="kicker">{t("lootcouncil.filter.content")}{!view.tiers.length && !view.contents.length ? <span className="lc-muted"> · {t("lootcouncil.filter.all")}</span> : null}</span>
                            <div className="lc-popbtns">
                                {o.tiers.map((tier) => (
                                    <button key={tier.id} type="button" disabled={ro} aria-pressed={view.tiers.includes(tier.id)}
                                        className={`btn btn-sm lc-filter lc-h-${tier.id}${view.tiers.includes(tier.id) ? " on" : ""}`}
                                        onClick={() => setView({ ...view, tiers: toggleIn(view.tiers, tier.id) })}>
                                        {tier.label}
                                    </button>
                                ))}
                            </div>
                            <div className="lc-popbtns">
                                {o.contents.map((c) => (
                                    <button key={c.id} type="button" disabled={ro} aria-pressed={view.contents.includes(c.id)} data-tip={c.label}
                                        className={`btn btn-sm lc-filter lc-h-${c.id}${view.contents.includes(c.id) ? " on" : ""}`}
                                        onClick={() => setView({ ...view, contents: toggleIn(view.contents, c.id) })}>
                                        {c.short}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="lc-field">
                            <label className="kicker" htmlFor="lc-p-bis">{t("lootcouncil.filter.bisList")}</label>
                            <select id="lc-p-bis" className="lc-sel" disabled={ro} value={view.bisTier} onChange={(e) => setView({ ...view, bisTier: e.target.value })}>
                                <option value="">{t("lootcouncil.filter.bisAutomatic")}</option>
                                {o.bisTiers.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                            </select>
                        </div>
                    </div>
                </Section>

                <WeightsEditor draft={weights} onChange={setWeights} data={data} readOnly={ro} />

                {!ro ? (
                    <div className="lc-wfoot">
                        <Button variant="ghost" onClick={toDefaults}>{t("lootcouncil.weights.reset")}</Button>
                        <span className="lc-grow" />
                        {dirty ? <span className="lc-muted">{t("lootcouncil.weights.unsaved")}</span> : null}
                        <Button icon="inv_misc_note_01" running={saving} disabled={!dirty} onClick={save}>{t("lootcouncil.weights.save")}</Button>
                    </div>
                ) : null}
            </div>

            {naming ? (
                <NameDialog
                    title={naming === "rename" ? t("lootcouncil.profiles.renameTitle", { name: row.name }) : t("lootcouncil.profiles.copyTitle", { name: row.name })}
                    initial={naming === "rename" ? row.name : t("lootcouncil.profiles.copyName", { name: row.name }).slice(0, 40)}
                    action={naming === "rename" ? t("lootcouncil.profiles.rename") : t("lootcouncil.profiles.copy")}
                    onClose={() => setNaming(null)}
                    onSubmit={async (name) => {
                        try {
                            const fresh = naming === "rename"
                                ? await updateCouncilProfile(row.id, { name })
                                : await createCouncilProfile(name, row.id);
                            setNaming(null);
                            toast(naming === "rename" ? t("lootcouncil.profiles.renamed", { name }) : t("lootcouncil.profiles.created", { name }));
                            if (naming === "rename") onStored(fresh); else onCopied(fresh.profile.id);
                            return null;
                        } catch (e) {
                            const err = e as ApiError;
                            return CODES.includes(err.code) ? t(`lootcouncil.profiles.err.${err.code}`) : err.message;
                        }
                    }}
                />
            ) : null}
        </div>
    );
}
