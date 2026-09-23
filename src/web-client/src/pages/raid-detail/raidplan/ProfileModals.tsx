import { useEffect, useMemo, useState } from "react";
import {
    createRaidplanProfile, deleteRaidplanProfile, updateRaidplanProfile,
    type ApiError, type RaidplanBoard, type RaidplanBoss, type RaidplanProfile, type RaidplanProfileInput,
} from "../../../api";
import { Button, Modal, useConfirm } from "../../../components/ui";
import { useToast } from "../../../components/Jobs";
import { groupProfiles, profileRows, profilesFor } from "../../../lib/raidplan";
import { useT } from "../../../i18n";

/** Where a profile applies, as the short line under its name. */
function useScopeLabel(bosses: RaidplanBoss[]) {
    const t = useT();
    return (p: RaidplanProfile): string => {
        if (!p.bossKey) return t("raidBoard.profile.scopeAll");
        if (!p.bossKey.includes("/")) return t("raidBoard.profile.scopeInstance");
        const boss = bosses.find((b) => b.key === p.bossKey);
        return boss ? boss.name : t("raidBoard.profile.scopeBoss");
    };
}

/**
 * "Taktik wählen": the profiles that fit the boss, grouped by category, with a
 * search. Picking one applies it (the caller asks first when the board already
 * holds rows). The two other things one does with profiles — saving the current
 * rows as one, and looking after the collection — sit in the foot.
 */
export function ProfilePickerModal({ open, onClose, profiles, bosses, bossKey, currentId, onPick, onSaveAs, onManage }: {
    open: boolean;
    onClose: () => void;
    profiles: RaidplanProfile[];
    bosses: RaidplanBoss[];
    bossKey: string;
    currentId: string;
    onPick: (profile: RaidplanProfile) => void;
    onSaveAs: () => void;
    onManage: () => void;
}) {
    const t = useT();
    const [query, setQuery] = useState("");
    const scope = useScopeLabel(bosses);
    const groups = useMemo(() => groupProfiles(profilesFor(profiles, bossKey), query), [profiles, bossKey, query]);
    useEffect(() => { if (open) setQuery(""); }, [open]);

    return (
        <Modal
            open={open} onClose={onClose} icon="inv_scroll_03" title={t("raidBoard.profile.pickTitle")} width={520} initialFocus=".rp-search"
            footer={(
                <>
                    <Button variant="ghost" onClick={onManage}>{t("raidBoard.profile.manage")}</Button>
                    <Button variant="ghost" onClick={onSaveAs}>{t("raidBoard.profile.saveAs")}</Button>
                </>
            )}
        >
            <input className="rp-search" value={query} placeholder={t("raidBoard.profile.search")} onChange={(e) => setQuery(e.target.value)} />
            {groups.length === 0 && (
                <p className="rp-muted">{profilesFor(profiles, bossKey).length === 0 ? t("raidBoard.profile.empty") : t("raidBoard.profile.noMatch")}</p>
            )}
            {groups.map((g) => (
                <div key={g.category || "-"} className="rp-group">
                    <h4 className="rp-kicker">{g.category || t("raidBoard.profile.noCategory")}</h4>
                    <ul className="rp-pick">
                        {g.profiles.map((p) => (
                            <li key={p.id}>
                                <button type="button" className={`rp-pick-row rp-pick-profile${p.id === currentId ? " is-on" : ""}`} onClick={() => onPick(p)}>
                                    <span className="rp-pick-name">{p.name}</span>
                                    <span className="rp-muted">{t("raidBoard.profile.rows", { count: p.targets.length })} · {scope(p)}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </Modal>
    );
}

type FormState = { name: string; category: string; bossKey: string; rows: string; notes: string };

const formOf = (p: RaidplanProfile): FormState => ({ name: p.name, category: p.category, bossKey: p.bossKey, rows: p.targets.map((r) => r.title).join("\n"), notes: p.notes });

const inputOf = (f: FormState): RaidplanProfileInput => ({
    name: f.name.trim(),
    category: f.category.trim(),
    bossKey: f.bossKey,
    targets: f.rows.split("\n").map((title) => ({ title: title.trim() })).filter((r) => r.title),
    notes: f.notes,
});

/**
 * The collection of tactic profiles, list first and one editor at a time
 * (docs/web-admin.md, "Editing a collection"). `draft` opens straight on a new
 * profile filled from the board's rows ("Als Taktik speichern"). Rows are edited
 * as one title per line — a profile holds titles only, players belong to a plan.
 */
export function ProfilesModal({ open, onClose, csrfToken, profiles, categories, bosses, bossKey, draft, limits, onChanged }: {
    open: boolean;
    onClose: () => void;
    csrfToken: string | null;
    profiles: RaidplanProfile[];
    categories: string[];
    bosses: RaidplanBoss[];
    bossKey: string;
    /** The current board: "Als Taktik speichern" starts from its rows and note. */
    draft: RaidplanBoard | null;
    limits: { profileName: number; profileCategory: number; title: number; targetsPerBoss: number; notes: number };
    /** The saved / changed / deleted profile's new list; `saved` is the profile that was created or updated. */
    onChanged: (profiles: RaidplanProfile[], saved?: RaidplanProfile) => void;
}) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const scope = useScopeLabel(bosses);
    const [editing, setEditing] = useState("");
    const [form, setForm] = useState<FormState>({ name: "", category: "", bossKey: "", rows: "", notes: "" });
    const [busy, setBusy] = useState(false);
    const boss = bosses.find((b) => b.key === bossKey) || null;
    const groups = useMemo(() => groupProfiles(profiles, ""), [profiles]);

    const blank = (): FormState => ({ name: "", category: "", bossKey: "", rows: "", notes: "" });
    // Opening (or re-opening) starts on the list, or straight on a new profile when there is a draft to save.
    useEffect(() => {
        if (!open) return;
        if (draft) {
            setForm({ ...blank(), rows: profileRows(draft).map((r) => r.title).join("\n"), notes: draft.notes, bossKey });
            setEditing("new");
        } else {
            setEditing("");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const startEdit = (p: RaidplanProfile) => { setForm(formOf(p)); setEditing(p.id); };
    const startNew = () => { setForm({ ...blank(), bossKey }); setEditing("new"); };
    const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
    const input = inputOf(form);
    const canSave = !!input.name && (input.targets || []).length > 0;

    const save = async () => {
        if (!canSave || busy) return;
        setBusy(true);
        try {
            const r = editing === "new"
                ? await createRaidplanProfile(csrfToken, input)
                : await updateRaidplanProfile(csrfToken, editing, input);
            toast(t("raidBoard.profile.saved", { name: input.name || "" }));
            onChanged(r.profiles, r.profile);
            if (draft) onClose(); else setEditing("");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const remove = async (p: RaidplanProfile) => {
        if (!(await ask({ title: t("raidBoard.profile.deleteTitle", { name: p.name }), text: t("raidBoard.profile.deleteText"), action: t("raidBoard.profile.delete"), tone: "danger" }))) return;
        try {
            const r = await deleteRaidplanProfile(csrfToken, p.id);
            toast(t("raidBoard.profile.deleted"));
            onChanged(r.profiles);
            setEditing("");
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    const instance = boss ? bosses.find((b) => b.instanceId === boss.instanceId) : null;
    const scopes = [
        { value: "", label: t("raidBoard.profile.scopeAllOption") },
        ...(boss && instance ? [{ value: boss.instanceId, label: t("raidBoard.profile.scopeInstanceOption", { name: boss.instanceName }) }] : []),
        ...(boss ? [{ value: boss.key, label: t("raidBoard.profile.scopeBossOption", { name: boss.name }) }] : []),
    ];
    // A profile made elsewhere keeps its scope in the select even when it is none of the three above.
    if (form.bossKey && !scopes.some((s) => s.value === form.bossKey)) scopes.push({ value: form.bossKey, label: form.bossKey });

    return (
        <Modal
            open={open} onClose={onClose} icon="inv_scroll_03"
            title={editing ? (editing === "new" ? t("raidBoard.profile.saveTitle") : t("raidBoard.profile.rename")) : t("raidBoard.profile.manageTitle")}
            width={560} initialFocus=".rp-form-name"
            hint={editing === "new" && draft ? t("raidBoard.profile.saveHint") : undefined}
            footer={editing ? (
                <>
                    {editing !== "new" && (
                        <Button variant="danger" onClick={() => { const p = profiles.find((x) => x.id === editing); if (p) remove(p); }}>{t("raidBoard.profile.delete")}</Button>
                    )}
                    <Button variant="ghost" onClick={() => (draft ? onClose() : setEditing(""))}>{t("raidBoard.profile.cancel")}</Button>
                    <Button onClick={save} disabled={!canSave} running={busy}>{t("raidBoard.profile.save")}</Button>
                </>
            ) : (
                <Button variant="ghost" onClick={startNew}>{t("raidBoard.profile.saveAs")}</Button>
            )}
        >
            {editing ? (
                <div className="rp-form">
                    <label>
                        <span className="rp-kicker">{t("raidBoard.profile.name")}</span>
                        <input className="rp-form-name" value={form.name} maxLength={limits.profileName} placeholder={t("raidBoard.profile.namePlaceholder")} onChange={(e) => set({ name: e.target.value })} />
                    </label>
                    <label>
                        <span className="rp-kicker">{t("raidBoard.profile.category")}</span>
                        <input value={form.category} maxLength={limits.profileCategory} list="rp-categories" placeholder={t("raidBoard.profile.categoryPlaceholder")} onChange={(e) => set({ category: e.target.value })} />
                        <datalist id="rp-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
                    </label>
                    <label>
                        <span className="rp-kicker">{t("raidBoard.profile.scope")}</span>
                        <select value={form.bossKey} onChange={(e) => set({ bossKey: e.target.value })}>
                            {scopes.map((s) => <option key={s.value || "all"} value={s.value}>{s.label}</option>)}
                        </select>
                    </label>
                    <label>
                        <span className="rp-kicker">{t("raidBoard.targets.title")}</span>
                        <textarea value={form.rows} rows={5} onChange={(e) => set({ rows: e.target.value })} />
                        {!canSave && input.name && <span className="rp-muted">{t("raidBoard.profile.needRows")}</span>}
                    </label>
                    <label>
                        <span className="rp-kicker">{t("raidBoard.targets.notes")}</span>
                        <textarea value={form.notes} rows={3} maxLength={limits.notes} onChange={(e) => set({ notes: e.target.value })} />
                    </label>
                </div>
            ) : (
                <>
                    {groups.length === 0 && <p className="rp-muted">{t("raidBoard.profile.manageEmpty")}</p>}
                    {groups.map((g) => (
                        <div key={g.category || "-"} className="rp-group">
                            <h4 className="rp-kicker">{g.category || t("raidBoard.profile.noCategory")}</h4>
                            <ul className="rp-pick">
                                {g.profiles.map((p) => (
                                    <li key={p.id}>
                                        <button type="button" className="rp-pick-row rp-pick-profile" onClick={() => startEdit(p)}>
                                            <span className="rp-pick-name">{p.name}</span>
                                            <span className="rp-muted">{t("raidBoard.profile.rows", { count: p.targets.length })} · {scope(p)}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                    {groups.length > 0 && <p className="rp-muted">{t("raidBoard.profile.manageHint")}</p>}
                </>
            )}
        </Modal>
    );
}
