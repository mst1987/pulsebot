// "Roster anlegen" and the roster's "Einstellungen" (#657, design canvas
// "Anlegen"): one form - name, category, game version, the Discord role(s) and
// the trial role, the managers (roles and single accounts), the places with
// −/+, the two switches - and for a new roster where its first members come
// from. A full admin edits everything; a manager of the roster its name, the
// places and the switches (the rest is greyed out with the reason). After a
// create the dialog says how many came in and which roles failed; the settings
// end with "Roster löschen" for a full admin (the Discord roles stay). In the
// settings a full admin also links the roster to its Kader of the Kaderplaner
// ("Kader im Kaderplaner", 1:1 - a Kader another roster holds is greyed out).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    createRoster, deleteRoster, getRosterOptions, updateRoster,
    type RosterDetail, type RosterInitial, type RosterOptions, type RosterSettingsPatch, type RosterSlots, type RosterSource, type StoredRoster,
} from "../../api";
import { useApi } from "../../hooks/useApi";
import { useT } from "../../i18n";
import { AsyncView, Button, Field, Modal, Segment, Switch, WowIcon, useConfirm } from "../../components/ui";
import RaidLoader from "../../components/ui/RaidLoader";
import { TrashIcon } from "../../components/ui/icons";
import { errorText, roleCodeText } from "../../lib/roster/rosterEdit";
import { ROLE_ICONS } from "../../lib/roster/rosters";
import { Notice, Stepper } from "./RosterParts";
import { ManagerAccounts, RoleChips, SourcePicker } from "./RosterFormParts";
import { useRosterAction } from "./useRosterAction";

type FormState = {
    name: string;
    categoryId: string;
    versionId: string;
    roleIds: string[];
    trialRoleId: string;
    managerRoleIds: string[];
    managerUsers: { userId: string; displayName: string }[];
    slots: RosterSlots;
    allowMultipleChars: boolean;
    signupOnly: boolean;
    source: RosterSource;
    kaderId: string;
    /** Settings: the Kader of the Kaderplaner linked to the roster ("" = none). */
    linkedKaderId: string;
};

const NO_SLOTS: RosterSlots = { total: 0, tank: 0, healer: 0, bench: 0 };

function initialCreate(options: RosterOptions, categoryId: string): FormState {
    const cat = options.categories.find((c) => c.id === categoryId && !c.rosterId) || null;
    const tpl = cat ? options.templateSlots[cat.id] : null;
    return {
        name: cat ? cat.name.slice(0, 40) : "",
        categoryId: cat ? cat.id : "",
        versionId: (cat && cat.versionId) || options.defaultVersion,
        roleIds: [],
        trialRoleId: "",
        managerRoleIds: [],
        managerUsers: [],
        slots: tpl ? { total: tpl.total, tank: tpl.tank, healer: tpl.healer, bench: tpl.bench } : { ...NO_SLOTS },
        allowMultipleChars: false,
        signupOnly: false,
        source: "role",
        kaderId: "",
        linkedKaderId: "",
    };
}

function initialSettings(data: RosterDetail): FormState {
    const s = data.settings;
    return {
        name: data.roster.name,
        categoryId: (s && s.categoryId) || "",
        versionId: (s && s.versionId) || data.roster.versionId,
        roleIds: s ? [...s.roleIds] : [],
        trialRoleId: (s && s.trialRoleId) || "",
        managerRoleIds: s ? [...s.managers.roleIds] : [],
        managerUsers: s ? [...s.managers.users] : [],
        slots: { ...data.roster.slots },
        allowMultipleChars: data.roster.allowMultipleChars,
        signupOnly: !!(s && s.signupOnly),
        source: "none",
        kaderId: "",
        linkedKaderId: (s && s.kaderId) || "",
    };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What a save sends: on create everything, on settings only what changed (a manager only his fields). */
function patchOf(form: FormState, base: FormState, create: boolean, admin: boolean): RosterSettingsPatch {
    const all: RosterSettingsPatch = {
        name: form.name.trim(),
        slots: form.slots,
        allowMultipleChars: form.allowMultipleChars,
        signupOnly: form.signupOnly,
        ...(admin ? {
            categoryId: form.categoryId || null,
            versionId: form.versionId,
            roleIds: form.roleIds,
            trialRoleId: form.trialRoleId || null,
            managers: { roleIds: form.managerRoleIds, userIds: form.managerUsers.map((u) => u.userId) },
        } : {}),
    };
    if (create) return all;
    const out: RosterSettingsPatch = {};
    if (all.name !== base.name) out.name = all.name;
    if (!same(form.slots, base.slots)) out.slots = form.slots;
    if (form.allowMultipleChars !== base.allowMultipleChars) out.allowMultipleChars = form.allowMultipleChars;
    if (form.signupOnly !== base.signupOnly) out.signupOnly = form.signupOnly;
    if (admin) {
        if (form.categoryId !== base.categoryId) out.categoryId = form.categoryId || null;
        if (form.versionId !== base.versionId) out.versionId = form.versionId;
        if (!same(form.roleIds, base.roleIds)) out.roleIds = form.roleIds;
        if (form.trialRoleId !== base.trialRoleId) out.trialRoleId = form.trialRoleId || null;
        if (!same(form.managerRoleIds, base.managerRoleIds) || !same(form.managerUsers.map((u) => u.userId), base.managerUsers.map((u) => u.userId))) {
            out.managers = { roleIds: form.managerRoleIds, userIds: form.managerUsers.map((u) => u.userId) };
        }
        if (form.linkedKaderId !== base.linkedKaderId) out.kaderId = form.linkedKaderId || null;
    }
    return out;
}

/** "Kader im Kaderplaner" (settings, full admins): the Kader linked 1:1; one another roster holds is greyed out. */
function KaderLinkField({ options, rosterId, value, onChange }: { options: RosterOptions; rosterId: string; value: string; onChange: (id: string) => void }) {
    const t = useT();
    const known = options.kaders.some((k) => k.id === value);
    return (
        <Field label={t("roster.form.kaderLink")} htmlFor="rn-f-kader" hint={t("roster.form.kaderHint")}>
            <select id="rn-f-kader" value={value} onChange={(e) => onChange(e.target.value)}>
                <option value="">{t("roster.form.noKader")}</option>
                {value && !known && <option value={value}>{t("roster.form.kaderGone")}</option>}
                {options.kaders.map((k) => {
                    const taken = !!k.rosterId && k.rosterId !== rosterId;
                    return <option key={k.id} value={k.id} disabled={taken}>{taken ? t("roster.form.kaderTaken", { name: k.name, roster: k.rosterName || "" }) : k.name}</option>;
                })}
            </select>
        </Field>
    );
}

/** The summary after a create: who came in, which roles failed. */
function CreatedSummary({ roster, initial }: { roster: StoredRoster; initial: RosterInitial }) {
    const t = useT();
    return (
        <section className="rn-dlg-sec">
            <p className="rn-done">{t("roster.form.created", { name: roster.name })}</p>
            <p>{t(`roster.form.addedFrom.${initial.source}`, { count: initial.added })}{initial.skipped ? ` ${t("roster.form.skipped", { count: initial.skipped })}` : ""}</p>
            {initial.error && <Notice tone="warn">{t("roster.form.initialError", { reason: roleCodeText(initial.error) })}</Notice>}
            {initial.roleFailures.length > 0 && (
                <Notice tone="warn">
                    <b>{t("roster.form.roleFailures", { count: initial.roleFailures.length })}</b>
                    <ul className="rn-lines">
                        {[...new Set(initial.roleFailures.map((f) => f.code))].map((code) => (
                            <li key={code}>{t("roster.form.roleFailureLine", { count: initial.roleFailures.filter((f) => f.code === code).length, reason: roleCodeText(code) })}</li>
                        ))}
                    </ul>
                </Notice>
            )}
            <p className="rn-sub">{t("roster.form.reconcileNote")}</p>
        </section>
    );
}

function RosterForm({ options, mode, data, presetCategory, onClose, onSaved }: {
    options: RosterOptions;
    mode: "create" | "settings";
    data?: RosterDetail;
    presetCategory: string;
    onClose: () => void;
    onSaved: (rosterId: string) => void;
}) {
    const t = useT();
    const ask = useConfirm();
    const navigate = useNavigate();
    const { run, busy } = useRosterAction();
    const create = mode === "create";
    const admin = options.isAdmin;
    const [base] = useState<FormState>(() => (create || !data ? initialCreate(options, presetCategory) : initialSettings(data)));
    const [form, setForm] = useState<FormState>(base);
    const [done, setDone] = useState<{ roster: StoredRoster; initial: RosterInitial } | null>(null);
    const set = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));
    const lockTip = admin ? undefined : t("roster.form.adminOnly");
    const locked = !admin;
    const category = options.categories.find((c) => c.id === form.categoryId) || null;
    const template = form.categoryId ? options.templateSlots[form.categoryId] : null;
    const dps = Math.max(0, form.slots.total - form.slots.tank - form.slots.healer);
    const slotsBad = form.slots.tank + form.slots.healer > form.slots.total && form.slots.total > 0;
    const sourceBad = create && ((form.source === "role" && !form.roleIds.length) || (form.source === "kader" && !form.kaderId) || (form.source === "raids" && !form.categoryId));
    const nameBad = !form.name.trim() && !form.categoryId;
    const patch = patchOf(form, base, create, admin);
    const nothing = !create && !Object.keys(patch).length;

    const pickCategory = (id: string) => {
        const cat = options.categories.find((c) => c.id === id) || null;
        const oldCat = options.categories.find((c) => c.id === form.categoryId) || null;
        const tpl = cat ? options.templateSlots[cat.id] : null;
        set({
            categoryId: id,
            ...(cat && (!form.name.trim() || (oldCat && form.name === oldCat.name.slice(0, 40))) ? { name: cat.name.slice(0, 40) } : {}),
            ...(cat && cat.versionId ? { versionId: cat.versionId } : {}),
            ...(create && tpl ? { slots: { total: tpl.total, tank: tpl.tank, healer: tpl.healer, bench: tpl.bench } } : {}),
            ...(!id && form.source === "raids" ? { source: "none" as RosterSource } : {}),
        });
    };

    const submit = async () => {
        if (create) {
            const result = await run("save", () => createRoster({ ...patch, source: form.source, ...(form.source === "kader" ? { kaderId: form.kaderId } : {}) }), () => null);
            if (result) {
                setDone(result);
                onSaved(result.roster.id);
            }
            return;
        }
        if (!data) return;
        const result = await run("save", () => updateRoster(data.roster.id, patch), (r) => (r.trimmedChars ? t("roster.form.savedTrimmed", { count: r.trimmedChars }) : t("roster.form.saved")));
        if (result) {
            onSaved(data.roster.id);
            onClose();
        }
    };

    const remove = async () => {
        if (!data) return;
        if (!(await ask({ title: t("roster.form.deleteTitle", { name: data.roster.name }), text: t("roster.form.deleteText"), action: t("roster.form.delete"), tone: "danger" }))) return;
        const result = await run("delete", () => deleteRoster(data.roster.id), () => t("roster.form.deleted", { name: data.roster.name }));
        if (result) navigate("/roster");
    };

    const footer = done ? (
        <Button onClick={() => navigate(`/roster/r/${encodeURIComponent(done.roster.id)}`)}>{t("roster.form.toRoster")}</Button>
    ) : (
        <>
            {!create && admin && <Button variant="danger" icon={<TrashIcon />} className="rn-foot-left" running={busy === "delete"} onClick={remove}>{t("roster.form.delete")}</Button>}
            <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button disabled={slotsBad || sourceBad || nameBad || nothing} running={busy === "save"} onClick={submit}>{create ? t("roster.form.create") : t("roster.form.save")}</Button>
        </>
    );

    return (
        <Modal
            open
            onClose={onClose}
            icon="achievement_guildperk_everybodysfriend"
            tone="roster"
            kicker={create ? t("roster.form.kickerNew") : t("roster.form.kickerSettings")}
            title={create ? (category ? t("roster.form.titleFor", { name: category.name }) : t("roster.form.title")) : t("roster.form.settingsTitle", { name: data?.roster.name || "" })}
            width={720}
            className="rn-dlg"
            footer={footer}
        >
            {done ? <CreatedSummary roster={done.roster} initial={done.initial} /> : (
                <>
                    <section className="rn-dlg-sec">
                        <h3 className="rn-lbl">{t("roster.form.basics")}</h3>
                        <Field label={t("roster.form.name")} htmlFor="rn-f-name" hint={t("roster.form.nameHint")} error={nameBad ? t("roster.err.invalid_name") : undefined}>
                            <input id="rn-f-name" value={form.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />
                        </Field>
                        <Field label={t("roster.form.category")} htmlFor="rn-f-cat" hint={locked ? lockTip : t("roster.form.categoryHint")}>
                            <select id="rn-f-cat" value={form.categoryId} disabled={locked} onChange={(e) => pickCategory(e.target.value)}>
                                <option value="">{t("roster.form.noCategory")}</option>
                                {options.categories.map((c) => {
                                    const taken = !!c.rosterId && c.rosterId !== data?.roster.id;
                                    return <option key={c.id} value={c.id} disabled={taken}>{taken ? t("roster.form.categoryTaken", { name: c.name, roster: c.rosterName }) : c.name}</option>;
                                })}
                            </select>
                        </Field>
                        {!create && admin && (options.kaders.length > 0 || !!form.linkedKaderId) && (
                            <KaderLinkField options={options} rosterId={data?.roster.id || ""} value={form.linkedKaderId} onChange={(linkedKaderId) => set({ linkedKaderId })} />
                        )}
                        {options.versions.length > 1 && (
                            <div className="rn-field-line" data-tip={lockTip}>
                                <span className="rn-lbl">{t("roster.form.version")}</span>
                                {locked
                                    ? <b>{options.versions.find((v) => v.id === form.versionId)?.label || form.versionId}</b>
                                    : <Segment ariaLabel={t("roster.form.version")} value={form.versionId} onChange={(v) => set({ versionId: v })} options={options.versions.map((v) => ({ value: v.id, label: v.label }))} />}
                            </div>
                        )}
                    </section>

                    <section className="rn-dlg-sec">
                        <h3 className="rn-lbl">{t("roster.form.roles")}</h3>
                        {!options.online && <Notice tone="warn">{t("roster.form.offline")}</Notice>}
                        {options.online && !options.canManageRoles && <Notice tone="warn">{t("roster.sync.noManageRoles")}</Notice>}
                        <RoleChips roles={options.roles} value={form.roleIds} onChange={(roleIds) => set({ roleIds, trialRoleId: roleIds.includes(form.trialRoleId) ? "" : form.trialRoleId })} disabled={locked} disabledTip={lockTip} label={t("roster.form.roles")} />
                        <p className="rn-sub">{t("roster.form.rolesHint")}</p>
                        <div className="rn-lbl rn-lbl-sub">{t("roster.form.trialRole")}</div>
                        <RoleChips roles={options.roles} value={form.trialRoleId ? [form.trialRoleId] : []} onChange={(ids) => set({ trialRoleId: ids[0] || "" })} multi={false} exclude={form.roleIds} disabled={locked} disabledTip={lockTip} label={t("roster.form.trialRole")} noneLabel={t("roster.form.noTrialRole")} />
                    </section>

                    <section className="rn-dlg-sec">
                        <h3 className="rn-lbl">{t("roster.form.managers")}</h3>
                        <p className="rn-sub">{t("roster.form.managersHint")}</p>
                        <div className="rn-lbl rn-lbl-sub">{t("roster.form.managerRoles")}</div>
                        <RoleChips roles={options.roles} value={form.managerRoleIds} onChange={(managerRoleIds) => set({ managerRoleIds })} requireManageable={false} disabled={locked} disabledTip={lockTip} label={t("roster.form.managerRoles")} />
                        <div className="rn-lbl rn-lbl-sub">{t("roster.form.managerUsers")}</div>
                        <ManagerAccounts users={form.managerUsers} onChange={(managerUsers) => set({ managerUsers })} versionId={form.versionId} disabled={locked} disabledTip={lockTip} />
                    </section>

                    <section className="rn-dlg-sec">
                        <h3 className="rn-lbl">{t("roster.form.slots")}</h3>
                        <div className="rn-targets">
                            <Stepper label={t("roster.form.slotTotal")} icon={<WowIcon name="achievement_guildperk_everybodysfriend" size={20} />} value={form.slots.total} onChange={(total) => set({ slots: { ...form.slots, total } })} />
                            <Stepper label={t("roster.form.slotTank")} icon={<WowIcon name={ROLE_ICONS.tank} size={20} />} value={form.slots.tank} onChange={(tank) => set({ slots: { ...form.slots, tank } })} />
                            <Stepper label={t("roster.form.slotHealer")} icon={<WowIcon name={ROLE_ICONS.healer} size={20} />} value={form.slots.healer} onChange={(healer) => set({ slots: { ...form.slots, healer } })} />
                            <Stepper label={t("roster.form.slotBench")} icon={<WowIcon name="inv_misc_groupneedmore" size={20} />} value={form.slots.bench} onChange={(bench) => set({ slots: { ...form.slots, bench } })} />
                        </div>
                        <p className={slotsBad ? "rn-bad" : "rn-sub"}>
                            {slotsBad ? t("roster.err.invalid_slots") : form.slots.total > 0 ? t("roster.form.dps", { count: dps }) : t("roster.form.noSlots")}
                            {!slotsBad && template && create ? ` ${t("roster.form.fromTemplate", { name: template.templateName })}` : ""}
                        </p>
                    </section>

                    <section className="rn-dlg-sec">
                        <h3 className="rn-lbl">{t("roster.form.rules")}</h3>
                        <p className="rn-sub">{t("roster.form.rulesHint")}</p>
                        <Switch checked={form.allowMultipleChars} onChange={(allowMultipleChars) => set({ allowMultipleChars })} label={t("roster.form.multi")} tip={t("roster.form.multiTip")} />
                        <Switch checked={form.signupOnly} onChange={(signupOnly) => set({ signupOnly })} label={t("roster.form.signupOnly")} tip={t("roster.form.signupOnlyTip")} />
                    </section>

                    {create && (
                        <section className="rn-dlg-sec">
                            <h3 className="rn-lbl">{t("roster.form.sourceTitle")}</h3>
                            <SourcePicker value={form.source} onChange={(source) => set({ source })} options={options} kaderId={form.kaderId} onKader={(kaderId) => set({ kaderId })} hasCategory={!!form.categoryId} hasRoles={form.roleIds.length > 0} />
                            <p className="rn-sub">{t("roster.form.reconcileNote")}</p>
                        </section>
                    )}
                </>
            )}
        </Modal>
    );
}

export default function RosterFormDialog({ mode, data, presetCategory = "", onClose, onSaved }: {
    mode: "create" | "settings";
    data?: RosterDetail;
    presetCategory?: string;
    onClose: () => void;
    /** Saved: the page reloads (a create also lands on the new roster from the summary). */
    onSaved: (rosterId: string) => void;
}) {
    const t = useT();
    const state = useApi(() => getRosterOptions(), []);
    return (
        <AsyncView
            state={state}
            loading={<Modal open onClose={onClose} title={t("roster.form.loading")} width={480}><RaidLoader compact text={t("roster.form.loading")} /></Modal>}
            error={(e) => <Modal open onClose={onClose} title={t("roster.form.title")} width={480}><p>{errorText(e)}</p></Modal>}
        >
            {(options) => <RosterForm options={options} mode={mode} data={data} presetCategory={presetCategory} onClose={onClose} onSaved={onSaved} />}
        </AsyncView>
    );
}
