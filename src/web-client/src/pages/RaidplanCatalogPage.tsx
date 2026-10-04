import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Pencil, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useOutletContext } from "react-router-dom";
import {
    canAccess, deleteCatalogEntry, getGameVersions, getRaidplanCatalog, resetCatalogEntry, saveCatalogEntry,
    type ApiError, type CatalogAdmin, type CatalogMob, type CatalogSpell } from "../api";
import { useApi } from "../hooks/useApi";
import type { ShellContext } from "../components/Shell";
import { MenuRailPage } from "../components/SectionRail";
import { useToast } from "../components/Jobs";
import { Modal, useConfirm } from "../components/ui/Modal";
import { Button, IconButton } from "../components/ui/Button";
import PageHead from "../components/ui/PageHead";
import Badge from "../components/ui/Badge";
import RaidLoader from "../components/ui/RaidLoader";
import WowIcon from "../components/ui/WowIcon";
import { MobIcon } from "./raid-detail/raidplan/AssignPanel";
import Flyout from "../components/raidplan/Flyout";
import { useContentVersion } from "../hooks/useContentVersion";
import { catalogOfVersion, inVersion, versionChips, versionLabel } from "../lib/raidplan/versions";
import { ASSIGN_META } from "../lib/raidplan/assign";
import { useT } from "../i18n";
import "../styles/raidplan/index.css";

type Tab = "mobs" | "spells";
type Draft = Partial<CatalogMob & CatalogSpell>;
type VersionInfo = { id: string; short: string; label: string };

/**
 * "Raidplan-Katalog" (docs/raidplan.md): the mobs (a boss's adds, council members, trash) that can be tanked or
 * marked in a plan, and the spells that are handed out as assignments. The code brings defaults; here they can be
 * changed (an override), hidden or reset, and own entries added. List first, one form at a time.
 *
 * Per game version (#544): the switch on top shows the entries of one version (the main version first, from
 * /api/game-versions' `defaultVersion`); a new entry starts in the version shown, the form's chips set its versions.
 */
export default function RaidplanCatalogPage() {
    const { user } = useOutletContext<ShellContext>();
    // beside the rail of Raid-Events' pages (components/SectionRail.tsx)
    return <MenuRailPage user={user} parent="raids"><Catalog user={user} /></MenuRailPage>;
}

function Catalog({ user }: ShellContext) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const canWrite = canAccess(user, "raidplan", "write");
    const catalog = useApi(() => getRaidplanCatalog(), []);
    const { data, setData } = catalog;
    // the game versions: the switch's choices and the main version it starts on (#541 makes that a setting; it is read from the same place)
    const gameVersions = useApi(() => getGameVersions(), []);
    const known: VersionInfo[] = useMemo(() => (gameVersions.data ? gameVersions.data.versions.map((v) => ({ id: v.id, short: v.short, label: v.label })) : []), [gameVersions.data]);
    // The game version shown (#563): the menu's content switch.
    const { version: picked } = useContentVersion();
    const version = picked || (gameVersions.data ? gameVersions.data.defaultVersion : "") || "tbc";
    const shown = useMemo(() => (data ? catalogOfVersion(data, version) : { mobs: [], spells: [] }), [data, version]);
    const [which, setWhich] = useState<Tab>("mobs");
    const [q, setQ] = useState("");
    const [draft, setDraft] = useState<Draft | null>(null);

    const needle = q.trim().toLowerCase();
    const instanceName = (id: string) => (data ? data.instances.find((i) => i.id === id) : undefined)?.name || t("catalog.noInstance");
    const bossName = useCallback((key: string) => {
        if (!data || !key) return "";
        for (const i of data.instances) { const b = i.bosses.find((x) => x.key === key); if (b) return b.name; }
        return "";
    }, [data]);
    const mobGroups = useMemo(() => {
        const groups = new Map<string, CatalogMob[]>();
        for (const m of shown.mobs) {
            if (needle && !`${m.name} ${bossName(m.bossKey)}`.toLowerCase().includes(needle)) continue;
            groups.set(m.instanceId, [...(groups.get(m.instanceId) || []), m]);
        }
        return [...groups.entries()];
    }, [shown, needle, bossName]);
    const spellGroups = useMemo(() => {
        const groups = new Map<string, CatalogSpell[]>();
        for (const s of shown.spells) {
            if (needle && !`${s.name} ${s.nameEn}`.toLowerCase().includes(needle)) continue;
            groups.set(s.type, [...(groups.get(s.type) || []), s]);
        }
        return [...groups.entries()];
    }, [shown, needle]);

    if (catalog.error) return <div className="empty">{t("catalog.loadError", { message: catalog.error.message })}</div>;
    if (!data) return <RaidLoader text={t("catalog.loading")} />;

    const run = async (job: () => Promise<CatalogAdmin>, message: string) => {
        try {
            setData(await job());
            if (message) toast(message);
            return true;
        } catch (err) {
            toast((err as ApiError).message, "err");
            return false;
        }
    };
    /** Left / Right / Home / End move between the tabs (a tablist's keys). */
    const tabKeys = (e: KeyboardEvent<HTMLElement>) => {
        const order: Tab[] = ["mobs", "spells"];
        const at = order.indexOf(which);
        const next = e.key === "ArrowRight" ? order[(at + 1) % 2] : e.key === "ArrowLeft" ? order[(at + 1) % 2] : e.key === "Home" ? order[0] : e.key === "End" ? order[1] : null;
        if (!next) return;
        e.preventDefault();
        setWhich(next);
        window.setTimeout(() => document.getElementById(`cattab-${next}`)?.focus(), 0);
    };

    const remove = async (kind: Tab, e: CatalogMob | CatalogSpell) => {
        const isDefault = e.id.startsWith("d:");
        if (!(await ask({ title: t(isDefault ? "catalog.hideTitle" : "catalog.deleteTitle", { name: e.name }), text: t(isDefault ? "catalog.hideText" : "catalog.deleteText"), action: t(isDefault ? "catalog.hide" : "catalog.delete"), tone: "danger" }))) return;
        await run(() => deleteCatalogEntry(kind, e.id), t("catalog.removed"));
    };

    /** "also Classic" when an entry is in more versions than the one shown. */
    const alsoIn = (e: CatalogMob | CatalogSpell) => {
        const others = (e.versions || []).filter((v) => v !== version);
        return others.length ? t("catalog.alsoIn", { versions: others.map((v) => versionLabel(known, v)).join(", ") }) : "";
    };
    const row = (kind: Tab, e: CatalogMob | CatalogSpell, icon: JSX.Element, meta: string, extra?: ReactNode) => (
        <li key={e.id} className="rp-crow">
            {icon}
            <span className="rp-crow-main"><strong>{e.name}</strong><span className="rp-muted">{[meta, alsoIn(e)].filter(Boolean).join(" · ")}</span></span>
            {extra}
            <Badge tone={e.source === "custom" ? "accent" : e.source === "override" ? "mid" : undefined}>{t(`catalog.source.${e.source}`)}</Badge>
            {canWrite && (
                <span className="rp-crow-tools">
                    <IconButton size="sm" icon={<Pencil size={15} />} tip={t("catalog.edit")} onClick={() => setDraft({ ...e })} />
                    {e.source === "override" && <IconButton size="sm" icon={<RotateCcw size={15} />} tip={t("catalog.reset")} onClick={() => run(() => resetCatalogEntry(kind, e.id), t("catalog.wasReset"))} />}
                    <IconButton size="sm" tone="danger" icon={<Trash2 size={15} />} tip={t(e.id.startsWith("d:") ? "catalog.hide" : "catalog.delete")} onClick={() => remove(kind, e)} />
                </span>
            )}
        </li>
    );

    const hidden = ((which === "mobs" ? data.hidden.mobs : data.hidden.spells) as (CatalogMob | CatalogSpell)[]).filter((e) => inVersion(e, version));
    return (
        <div className="rp-catalog">
            <PageHead
                icon="inv_misc_book_09" tone="raids" kicker={t("planTemplates.kicker")} title={t("catalog.title")}
                action={canWrite ? <Button onClick={() => setDraft(which === "mobs" ? { kind: "add", instanceId: "", bossKey: "", versions: [version] } : { type: "curse", classes: [], versions: [version] })}><Plus size={16} /> {t(which === "mobs" ? "catalog.newMob" : "catalog.newSpell")}</Button> : undefined}
            />
            <p className="rp-muted">{t("catalog.intro")}</p>
            <div className="rp-tfilters">
                <div className="tabs rp-cattabs" role="tablist" aria-label={t("catalog.title")} onKeyDown={tabKeys}>
                    {(["mobs", "spells"] as Tab[]).map((x) => (
                        <button key={x} type="button" role="tab" id={`cattab-${x}`} aria-selected={which === x} tabIndex={which === x ? 0 : -1} className={`tab-btn${which === x ? " active" : ""}`} onClick={() => setWhich(x)}>
                            <WowIcon name={x === "mobs" ? "ability_warrior_defensivestance" : "spell_shadow_curseofsargeras"} size={18} />
                            <span>{t(`catalog.tab.${x}`)}</span>
                            <span className="tab-count">{x === "mobs" ? shown.mobs.length : shown.spells.length}</span>
                        </button>
                    ))}
                </div>
                <label className="rp-tsearch">
                    <Search size={15} aria-hidden="true" />
                    <input value={q} placeholder={t("catalog.search")} aria-label={t("catalog.search")} onChange={(e) => setQ(e.target.value)} />
                </label>
            </div>

            {which === "mobs" && mobGroups.map(([inst, list]) => (
                <section key={inst} className="rp-cgroup">
                    <h3 className="rp-kicker">{instanceName(inst)}</h3>
                    <ul className="rp-clist">{list.map((m) => row("mobs", m, <MobIcon icon={m.icon} size={30} />, [t(`catalog.kind.${m.kind}`), bossName(m.bossKey)].filter(Boolean).join(" · "), m.similar && m.source === "default" ? <Badge tip={t("catalog.similarTip")}>{t("catalog.similar")}</Badge> : undefined))}</ul>
                </section>
            ))}
            {which === "spells" && spellGroups.map(([type, list]) => (
                <section key={type} className="rp-cgroup">
                    <h3 className="rp-kicker"><WowIcon name={(ASSIGN_META[type] || ASSIGN_META.other).icon} size={18} /> {t(`raidBoard.assign.type.${type}`)}</h3>
                    <ul className="rp-clist">{list.map((s) => row("spells", s, <WowIcon name={s.icon} size={30} />, s.classes.join(", ")))}</ul>
                </section>
            ))}
            {((which === "mobs" && mobGroups.length === 0) || (which === "spells" && spellGroups.length === 0)) && (
                <p className="rp-muted">{!needle && (which === "mobs" ? shown.mobs : shown.spells).length === 0 ? t("catalog.versionNone", { version: versionLabel(known, version) }) : t("catalog.none")}</p>
            )}

            {hidden.length > 0 && (
                <section className="rp-cgroup">
                    <h3 className="rp-kicker">{t("catalog.hidden")} · {hidden.length}</h3>
                    <ul className="rp-clist">
                        {hidden.map((e) => (
                            <li key={e.id} className="rp-crow is-hidden">
                                <span className="rp-crow-main"><strong>{e.name}</strong></span>
                                {canWrite && <Button variant="ghost" size="sm" onClick={() => run(() => resetCatalogEntry(which, e.id), t("catalog.wasReset"))}><RotateCcw size={14} /> {t("catalog.restore")}</Button>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {draft && (
                <EntryModal
                    which={which} data={data} known={known} initial={draft} onClose={() => setDraft(null)}
                    onSave={async (d) => { if (await run(() => saveCatalogEntry(which, d), t("catalog.saved"))) setDraft(null); }}
                />
            )}
        </div>
    );
}

/** The form of one mob or spell. */
function EntryModal({ which, data, known, initial, onClose, onSave }: {
    which: Tab;
    data: CatalogAdmin;
    /** the game versions the chips offer */
    known: VersionInfo[];
    initial: Draft;
    onClose: () => void;
    onSave: (d: Draft) => Promise<void>;
}) {
    const t = useT();
    const [f, setF] = useState<Draft>(initial);
    const [busy, setBusy] = useState(false);
    const inst = data.instances.find((i) => i.id === f.instanceId);
    const chosen = f.versions || [];
    // the instances of the entry's versions (and the one it has, so an old choice never vanishes)
    const instances = data.instances.filter((i) => chosen.indexOf(i.versionId) >= 0 || i.id === f.instanceId);
    const toggleVersion = (v: string) => setF((cur) => ({ ...cur, versions: (cur.versions || []).includes(v) ? (cur.versions || []).filter((x) => x !== v) : [...(cur.versions || []), v] }));
    const toggleClass = (c: string) => setF((cur) => ({ ...cur, classes: (cur.classes || []).includes(c) ? (cur.classes || []).filter((x) => x !== c) : [...(cur.classes || []), c] }));
    return (
        <Modal
            open onClose={onClose} icon="inv_misc_book_09" width={520}
            title={t(initial.id ? "catalog.editTitle" : which === "mobs" ? "catalog.newMob" : "catalog.newSpell")}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("raidBoard.profile.cancel")}</Button>
                    <Button disabled={!(f.name || "").trim() || chosen.length === 0} running={busy} onClick={async () => { setBusy(true); try { await onSave({ ...f, name: (f.name || "").trim() }); } finally { setBusy(false); } }}>{t("raidBoard.profile.save")}</Button>
                </>
            )}
        >
            <div className="rp-form">
                <label>
                    <span className="rp-kicker">{t("raidBoard.profile.name")}</span>
                    <input className="rp-form-name" value={f.name || ""} maxLength={data.limits.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                </label>
                <div>
                    <span className="rp-kicker">{t("catalog.versions")}</span>
                    <div className="rp-classpick" role="group" aria-label={t("catalog.versions")}>
                        {versionChips(known, chosen).map((v) => <button key={v.id} type="button" className={`rp-classbtn${chosen.includes(v.id) ? " is-on" : ""}`} aria-pressed={chosen.includes(v.id)} onClick={() => toggleVersion(v.id)}>{v.label}</button>)}
                    </div>
                    <span className="rp-muted">{t("catalog.versionsHint")}</span>
                </div>
                {which === "spells" && (
                    <label>
                        <span className="rp-kicker">{t("catalog.nameEn")}</span>
                        <input value={f.nameEn || ""} maxLength={data.limits.name} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
                    </label>
                )}
                {which === "mobs" && (
                    <>
                        <label>
                            <span className="rp-kicker">{t("catalog.kindLabel")}</span>
                            <select value={f.kind || "add"} onChange={(e) => setF({ ...f, kind: e.target.value as CatalogMob["kind"] })}>
                                {data.kinds.map((k) => <option key={k} value={k}>{t(`catalog.kind.${k}`)}</option>)}
                            </select>
                        </label>
                        <label>
                            <span className="rp-kicker">{t("catalog.instance")}</span>
                            <select value={f.instanceId || ""} onChange={(e) => setF({ ...f, instanceId: e.target.value, bossKey: "" })}>
                                <option value="">{t("catalog.noInstance")}</option>
                                {instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                            </select>
                        </label>
                        <label>
                            <span className="rp-kicker">{t("catalog.boss")}</span>
                            <select value={f.bossKey || ""} disabled={!inst} onChange={(e) => setF({ ...f, bossKey: e.target.value })}>
                                <option value="">{t("catalog.noBoss")}</option>
                                {(inst ? inst.bosses : []).map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
                            </select>
                            <span className="rp-muted">{t("catalog.bossHint")}</span>
                        </label>
                    </>
                )}
                {which === "spells" && (
                    <>
                        <label>
                            <span className="rp-kicker">{t("catalog.typeLabel")}</span>
                            <select value={f.type || "other"} onChange={(e) => setF({ ...f, type: e.target.value as CatalogSpell["type"] })}>
                                {data.types.map((x) => <option key={x} value={x}>{t(`raidBoard.assign.type.${x}`)}</option>)}
                            </select>
                        </label>
                        <div>
                            <span className="rp-kicker">{t("catalog.classes")}</span>
                            <div className="rp-classpick" role="group" aria-label={t("catalog.classes")}>
                                {data.classes.map((c) => <button key={c} type="button" className={`rp-classbtn${(f.classes || []).includes(c) ? " is-on" : ""}`} aria-pressed={(f.classes || []).includes(c)} onClick={() => toggleClass(c)}>{c}</button>)}
                            </div>
                            <span className="rp-muted">{t("catalog.classesHint")}</span>
                        </div>
                    </>
                )}
                <label>
                    <span className="rp-kicker">{t("catalog.icon")}</span>
                    {which === "mobs" && <IconPicker choices={data.iconChoices} value={(f.icon || "").toLowerCase()} onPick={(n) => setF({ ...f, icon: n })} />}
                    <span className="rp-iconfield">
                        {which === "mobs" ? <MobIcon icon={(f.icon || "").toLowerCase()} size={30} /> : <WowIcon name={(f.icon || "").toLowerCase() || "inv_misc_questionmark"} size={30} />}
                        <input value={f.icon || ""} maxLength={64} placeholder={which === "mobs" ? "spell_fire_flamebolt" : "spell_shadow_curseofsargeras"} onChange={(e) => setF({ ...f, icon: e.target.value })} />
                    </span>
                    <span className="rp-muted">{t(which === "mobs" ? "catalog.iconHintMob" : "catalog.iconHintSpell")}</span>
                </label>
                <label>
                    <span className="rp-kicker">{t("catalog.note")}</span>
                    <textarea value={f.note || ""} rows={2} maxLength={data.limits.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
                </label>
            </div>
        </Modal>
    );
}

/** The icon of a mob: the chosen one on a button; it opens the shared flyout with the icons by category (search, pages, no scrolling). */
function IconPicker({ choices, value, onPick }: { choices: Record<string, string[]>; value: string; onPick: (name: string) => void }) {
    const t = useT();
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const options = Object.entries(choices).flatMap(([cat, list]) => list.map((n) => ({
        key: n, label: n, group: cat, on: value === n, node: <MobIcon icon={n} size={28} />,
    })));
    return (
        <div className="rp-iconpick">
            <button type="button" className="rp-assign-btn" aria-haspopup="dialog" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
                {value ? <MobIcon icon={value} size={22} /> : null}<span>{value || t("catalog.iconSearch")}</span>
            </button>
            {anchor && <Flyout anchor={anchor} title={t("catalog.icon")} multi={false} options={options} onToggle={(n) => { onPick(n); setAnchor(null); }} onClose={() => setAnchor(null)} />}
        </div>
    );
}
