import { useEffect, useMemo, useState } from "react";
import { BookOpen, Save, Search } from "lucide-react";
import {
    createRaidplanProfile, deleteRaidplanProfile, updateRaidplanProfile,
    type ApiError, type RaidplanBoard, type RaidplanBoss, type RaidplanProfile, type RaidplanProfileInput,
} from "../../../api";
import { Button, Modal, useConfirm } from "../../../components/ui";
import { useToast } from "../../../components/Jobs";
import { ActionIcon } from "../../../components/raidplan/ActionIcon";
import { groupProfiles, profilesFor } from "../../../lib/raidplan";
import { libraryCategories, libraryView, stepsOf } from "../../../lib/steps";
import { useT } from "../../../i18n";

/** Where a profile applies, as the short line under its name. */
function useScopeLabel(bosses: RaidplanBoss[]) {
    const t = useT();
    return (p: RaidplanProfile): string => {
        if (!p.bossKey) return t("raidBoard.steps.library.forAll");
        if (!p.bossKey.includes("/")) return t("raidBoard.profile.scopeInstance");
        const boss = bosses.find((b) => b.key === p.bossKey);
        return boss ? boss.name : t("raidBoard.profile.scopeBoss");
    };
}

const TILES = 6;

/**
 * The library of saved tactics ("Bibliothek", design "Taktik · Details"): the tactics that fit the section as tiles, category tabs and a
 * search, six tiles at a time and no scrolling. "Auf diesen Boss anwenden" ADDS the tactic's steps under the section's (nothing is
 * replaced); slots and classes resolve against the raid. The foot saves the section's steps as a tactic and opens the management.
 */
export function LibraryModal({ open, onClose, profiles, bosses, bossKey, bossName, onPick, onSaveAs, onManage, canSave }: {
    open: boolean;
    onClose: () => void;
    profiles: RaidplanProfile[];
    bosses: RaidplanBoss[];
    bossKey: string;
    bossName: string;
    onPick: (profile: RaidplanProfile) => void;
    onSaveAs: () => void;
    onManage: () => void;
    /** the section has steps to save */
    canSave: boolean;
}) {
    const t = useT();
    const [query, setQuery] = useState("");
    const [cat, setCat] = useState("");
    const scope = useScopeLabel(bosses);
    const fit = useMemo(() => profilesFor(profiles, bossKey), [profiles, bossKey]);
    const cats = useMemo(() => libraryCategories(fit), [fit]);
    const view = libraryView(fit, cat, query, TILES);
    useEffect(() => { if (open) { setQuery(""); setCat(""); } }, [open]);
    const count = (c: string) => fit.filter((p) => !c || p.category === c).length;

    return (
        <Modal
            open={open} onClose={onClose} width={860} className="rp-lib" icon={<BookOpen size={20} />} kicker={t("raidBoard.steps.library.kicker", { boss: bossName })} title={t("raidBoard.steps.library.title")} initialFocus=".rp-lib-search input"
            footer={(
                <>
                    <Button variant="ghost" icon={<Save size={15} />} disabled={!canSave} onClick={onSaveAs}>{t("raidBoard.steps.library.saveAs")}</Button>
                    <Button variant="ghost" onClick={onManage}>{t("raidBoard.steps.library.manage")}</Button>
                    <Button variant="ghost" onClick={onClose}>{t("raidBoard.steps.library.close")}</Button>
                </>
            )}
        >
            <p className="rp-muted rp-lib-hint">{t("raidBoard.steps.library.hint")}</p>
            <div className="rp-lib-tools">
                <span className="rp-amb-seg" role="tablist" aria-label={t("raidBoard.profile.category")}>
                    <button type="button" role="tab" aria-selected={cat === ""} className={cat === "" ? "is-on" : ""} onClick={() => setCat("")}>{t("raidBoard.steps.category.all")} <span className="rp-muted">{count("")}</span></button>
                    {cats.map((c) => <button key={c} type="button" role="tab" aria-selected={cat === c} className={cat === c ? "is-on" : ""} onClick={() => setCat(c)}>{c} <span className="rp-muted">{count(c)}</span></button>)}
                </span>
                <label className="rp-amb-search rp-lib-search"><Search size={15} aria-hidden="true" /><input value={query} placeholder={t("raidBoard.am.search")} aria-label={t("raidBoard.am.search")} onChange={(e) => setQuery(e.target.value)} /></label>
            </div>
            <div className="rp-lib-grid">
                {view.shown.map((p) => {
                    const steps = p.steps || [];
                    return (
                        <div key={p.id} className="rp-lib-tile">
                            <div className="rp-lib-tile-head"><ActionIcon action={steps[0] ? steps[0].action : "note"} size={26} /><b>{p.name}</b></div>
                            <div className="rp-lib-meta">{p.category && <span className="rp-lib-cat">{p.category}</span>}<span className="rp-muted">{t("raidBoard.steps.nSteps", { n: steps.length })} · {scope(p)}</span></div>
                            <ul>
                                {steps.slice(0, 2).map((s) => <li key={s.id}><ActionIcon action={s.action} size={18} /><span>{s.sentence || t(`raidBoard.steps.actions.${s.action}`)}</span></li>)}
                                {steps.length > 2 && <li className="rp-muted">{t("raidBoard.steps.library.moreSteps", { n: steps.length - 2 })}</li>}
                            </ul>
                            <Button size="sm" disabled={steps.length === 0} onClick={() => onPick(p)}>{t("raidBoard.steps.library.apply")}</Button>
                        </div>
                    );
                })}
            </div>
            {view.shown.length === 0 && <p className="rp-muted">{fit.length === 0 ? t("raidBoard.steps.library.empty") : t("raidBoard.steps.library.noMatch")}</p>}
            {view.more > 0 && <p className="rp-muted">{t("raidBoard.steps.library.more", { n: view.more })}</p>}
        </Modal>
    );
}

type FormState = { name: string; category: string; bossKey: string };

/**
 * "Taktiken verwalten": the collection, list first and one editor at a time (docs/web-admin.md, "Editing a collection"): rename, file
 * under a category (offered ones as chips or free), where it applies, delete. The steps themselves are edited on a board and saved from
 * there. `draft` opens straight on a new tactic from the section's steps ("Als Taktik speichern"): slots and classes are kept, players
 * are left out (a library tactic is for any raid).
 */
export function ProfilesModal({ open, onClose, csrfToken, profiles, categories, bosses, bossKey, draft, limits, onChanged }: {
    open: boolean;
    onClose: () => void;
    csrfToken: string | null;
    profiles: RaidplanProfile[];
    categories: string[];
    bosses: RaidplanBoss[];
    bossKey: string;
    /** The current board: "Als Taktik speichern" starts from its steps and note. */
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
    const [form, setForm] = useState<FormState>({ name: "", category: "", bossKey: "" });
    const [busy, setBusy] = useState(false);
    const boss = bosses.find((b) => b.key === bossKey) || null;
    const groups = useMemo(() => groupProfiles(profiles, ""), [profiles]);
    const offered = useMemo(() => libraryCategories(profiles).concat(categories.filter((c) => libraryCategories(profiles).indexOf(c) < 0)), [profiles, categories]);

    useEffect(() => {
        if (!open) return;
        if (draft) {
            setForm({ name: "", category: "", bossKey });
            setEditing("new");
        } else {
            setEditing("");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const startEdit = (p: RaidplanProfile) => { setForm({ name: p.name, category: p.category, bossKey: p.bossKey }); setEditing(p.id); };
    const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
    const draftSteps = draft ? stepsOf(draft).map((s) => ({ ...s, participants: s.participants.filter((r) => r.indexOf("user:") !== 0) })) : [];
    const input: RaidplanProfileInput = { name: form.name.trim(), category: form.category.trim(), bossKey: form.bossKey, ...(editing === "new" ? { steps: draftSteps, notes: draft ? draft.notes : "", targets: [] } : {}) };
    const canSave = !!input.name && (editing !== "new" || draftSteps.length > 0);

    const save = async () => {
        if (!canSave || busy) return;
        setBusy(true);
        try {
            const r = editing === "new" ? await createRaidplanProfile(csrfToken, input) : await updateRaidplanProfile(csrfToken, editing, input);
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

    const scopes = [
        { value: "", label: t("raidBoard.profile.scopeAllOption") },
        ...(boss ? [{ value: boss.instanceId, label: t("raidBoard.profile.scopeInstanceOption", { name: boss.instanceName }) }] : []),
        ...(boss ? [{ value: boss.key, label: t("raidBoard.profile.scopeBossOption", { name: boss.name }) }] : []),
    ];
    if (form.bossKey && !scopes.some((s) => s.value === form.bossKey)) scopes.push({ value: form.bossKey, label: form.bossKey });
    const stepCount = (p: RaidplanProfile) => t("raidBoard.steps.nSteps", { n: (p.steps || []).length });

    return (
        <Modal
            open={open} onClose={onClose} icon="inv_scroll_03"
            title={editing ? (editing === "new" ? t("raidBoard.profile.saveTitle") : t("raidBoard.profile.rename")) : t("raidBoard.profile.manageTitle")}
            width={600} initialFocus=".rp-form-name"
            hint={editing === "new" && draft ? t("raidBoard.steps.library.saveHint", { n: draftSteps.length }) : undefined}
            footer={editing ? (
                <>
                    {editing !== "new" && <Button variant="danger" onClick={() => { const p = profiles.find((x) => x.id === editing); if (p) remove(p); }}>{t("raidBoard.profile.delete")}</Button>}
                    <Button variant="ghost" onClick={() => (draft ? onClose() : setEditing(""))}>{t("raidBoard.profile.cancel")}</Button>
                    <Button onClick={save} disabled={!canSave} running={busy}>{t("raidBoard.profile.save")}</Button>
                </>
            ) : undefined}
        >
            {editing ? (
                <div className="rp-form">
                    <label>
                        <span className="rp-kicker">{t("raidBoard.profile.name")}</span>
                        <input className="rp-form-name" value={form.name} maxLength={limits.profileName} placeholder={t("raidBoard.profile.namePlaceholder")} onChange={(e) => set({ name: e.target.value })} />
                    </label>
                    <div className="rp-form-field">
                        <span className="rp-kicker">{t("raidBoard.profile.category")}</span>
                        <span className="rp-lib-cats">
                            {offered.map((c) => <button key={c} type="button" aria-pressed={form.category === c} className={`rp-amb-tile rp-st-pick is-sm${form.category === c ? " is-on" : ""}`} onClick={() => set({ category: form.category === c ? "" : c })}><span className="rp-amb-name">{c}</span></button>)}
                        </span>
                        <input value={form.category} maxLength={limits.profileCategory} placeholder={t("raidBoard.profile.categoryPlaceholder")} aria-label={t("raidBoard.profile.category")} onChange={(e) => set({ category: e.target.value })} />
                    </div>
                    <div className="rp-form-field">
                        <span className="rp-kicker">{t("raidBoard.profile.scope")}</span>
                        <span className="rp-amb-seg" role="radiogroup" aria-label={t("raidBoard.profile.scope")}>
                            {scopes.map((s) => <button key={s.value || "all"} type="button" role="radio" aria-checked={form.bossKey === s.value} className={form.bossKey === s.value ? "is-on" : ""} onClick={() => set({ bossKey: s.value })}>{s.label}</button>)}
                        </span>
                    </div>
                    {editing !== "new" && <p className="rp-muted">{stepCount(profiles.find((x) => x.id === editing) || ({ steps: [] } as unknown as RaidplanProfile))} · {t("raidBoard.steps.library.editOnBoard")}</p>}
                    {editing === "new" && draftSteps.length === 0 && <p className="rp-muted">{t("raidBoard.steps.library.noSteps")}</p>}
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
                                            <span className="rp-muted">{stepCount(p)} · {scope(p)}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </>
            )}
        </Modal>
    );
}
