import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
    applyPugOnboarding, getPugOnboarding,
    type ApiError, type PugCategory, type PugItemStatus, type PugOnboardingOverview, type PugPrerequisite, type PugPrompt, type PugRole,
} from "../../../api";
import {
    blockers, canApply, doneCount, fallbackCategoriesOf, hasPug, previewOf, roleNameOf, rowsOf, selectedIdsOf, sortValueOf, statusTone,
    toggleCategory, visibleChannelsOf, type PugSortKey,
} from "../../../lib/settings/pugOnboarding";
import { useTableSort } from "../../../lib/ui/tableSort";
import { SortTh } from "../../../components/ui/table/SortTh";
import { formatDateTime } from "../../../lib/format";
import { useT } from "../../../i18n";
import { useToast } from "../../../components/shell/Jobs";
import { CheckMark, PlusIcon, SendIcon, WarnIcon, XIcon } from "../../../components/ui/icons/icons";
import { Modal } from "../../../components/ui/overlay/Modal";
import { Button } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import Switch from "../../../components/ui/form/Switch";
import PartHead from "../../../components/ui/layout/PartHead";
import RaidLoader from "../../../components/ui/layout/RaidLoader";
import { AdminOnlyBadge } from "../../../components/settings/settingsUi";

// Einstellungen → Verbindungen → Discord-Server, part "Rollen & Onboarding" (#906).
// For a PuG server: version and class roles, the PuG categories closed to everyone
// without the version role, and the two onboarding questions. The page shows wanted
// next to actual; only "In Discord übernehmen" (after a preview) writes. A switch per
// PuG category decides which of them the apply covers. Full admins only: the API
// answers everyone else with 403 forbidden, and the part then hides itself. Only the
// servers with the switch "PuG-Server" come in (`servers`); none = one line of hint.

type ServerChoice = { id: string; name: string; label: string; raidCategories?: number };

/** A role colour as a dot; "" = no colour (Discord's grey). */
const Dot = ({ color }: { color: string }) => (
    <span className="pug-dot" aria-hidden="true" style={color ? ({ "--pug-color": color } as CSSProperties) : undefined} />
);

function StatusBadge({ status }: { status: PugItemStatus }) {
    const t = useT();
    const icon = status === "same" ? <CheckMark /> : status === "lost" ? <XIcon /> : status === "new" ? <PlusIcon /> : <WarnIcon />;
    return <Badge tone={statusTone(status)} size="sm" icon={icon}>{t(`pugOnboarding.status.${status}`)}</Badge>;
}

export default function PugOnboardingPart({ servers }: { servers: ServerChoice[] }) {
    const t = useT();
    const toast = useToast();
    // "" = not chosen yet: the API opens with the first server that has a PuG category.
    const [guildId, setGuildId] = useState("");
    // undefined = every PuG category of the server (the default: all switched on)
    const [categoryIds, setCategoryIds] = useState<string[] | undefined>(undefined);
    const [data, setData] = useState<PugOnboardingOverview | null>(null);
    const [error, setError] = useState("");
    const [hidden, setHidden] = useState(false);
    const [preview, setPreview] = useState(false);
    const [busy, setBusy] = useState(false);
    const sorted = useTableSort<PugSortKey>("settings-pug-onboarding-sort", { what: "asc", want: "asc", have: "asc", status: "asc" }, "what");

    // The list changed (the chosen server removed): open with the default one again.
    useEffect(() => {
        if (guildId && !servers.some((s) => s.id === guildId)) { setGuildId(""); setCategoryIds(undefined); }
    }, [servers, guildId]);

    // Each load gets a number; only the answer of the latest one sets the state, so a slow
    // answer for a server chosen before cannot overwrite the one chosen after.
    const loadSeq = useRef(0);
    const load = () => {
        if (!servers.length) return;
        const seq = ++loadSeq.current;
        setData(null);
        getPugOnboarding(guildId || undefined, categoryIds)
            .then((d) => {
                if (seq !== loadSeq.current) return;
                setData(d); setError("");
                if (!guildId && d.guildId) setGuildId(d.guildId);
            })
            .catch((err: ApiError) => {
                if (seq !== loadSeq.current) return;
                if (err.code === "forbidden") setHidden(true); else setError(err.message);
            });
    };
    useEffect(load, [guildId, categoryIds, servers.length]);

    const chooseServer = (id: string) => { setCategoryIds(undefined); setGuildId(id); };
    const switchCategory = (id: string, on: boolean) => { if (data) setCategoryIds(toggleCategory(data, id, on)); };

    const apply = async () => {
        if (!data) return;
        setBusy(true);
        try {
            const res = await applyPugOnboarding(data.guildId, selectedIdsOf(data), data.fingerprint || "");
            const count = doneCount(res.done);
            toast(t("pugOnboarding.done", { count }));
            setData(res.overview);
            setPreview(false);
        } catch (err) {
            const e = err as ApiError;
            toast(e.code === "changed" ? t("pugOnboarding.changed") : e.message, "err");
            setPreview(false);
            load();
        } finally {
            setBusy(false);
        }
    };

    const head = (
        <PartHead
            variant="plain"
            title={t("pugOnboarding.title")}
            tip={t("pugOnboarding.title")}
            tipSub={t("pugOnboarding.tipSub")}
            action={servers.length === 0 ? undefined : (
                <span className="sync-actions">
                    {servers.length > 1 && (
                        <select aria-label={t("pugOnboarding.server")} value={guildId} onChange={(e) => chooseServer(e.target.value)}>
                            {!guildId && <option value="">…</option>}
                            {servers.map((s) => <option key={s.id} value={s.id}>{s.label || s.name || s.id}</option>)}
                        </select>
                    )}
                    <Button variant="ghost" size="sm" icon={<SendIcon />} disabled={!canApply(data) || busy}
                        data-tip={t("pugOnboarding.applyTip")} onClick={() => setPreview(true)}>
                        {t("pugOnboarding.apply")}
                    </Button>
                </span>
            )}
        />
    );

    if (hidden) return null;
    // #906: only servers with the switch "PuG-Server" are offered; without one the part is a single line.
    if (!servers.length || data?.notPugServer) return <section className="sync-part">{head}<div className="sync-empty">{t("pugOnboarding.notPugServer")}</div></section>;
    if (error) return <section className="sync-part">{head}<div className="sync-empty">{error}</div></section>;
    if (!data) return <section className="sync-part">{head}<RaidLoader compact text={t("pugOnboarding.loading")} /></section>;
    if (!data.online) return <section className="sync-part">{head}<div className="sync-empty">{t("pugOnboarding.offline")}</div></section>;

    const other = data.otherCategories || [];
    if (!hasPug(data)) {
        return (
            <section className="sync-part">
                {head}
                <div className="sync-empty">{t("pugOnboarding.noPug")}</div>
                {other.length > 0 && <div className="pug-note">{t("pugOnboarding.otherCategories", { names: other.map((c) => c.name).join(", ") })}</div>}
            </section>
        );
    }

    const failed = blockers(data);
    const changes = data.changes || 0;
    const appliedAt = data.applied ? Date.parse(data.applied.at) : 0;
    const none = selectedIdsOf(data).length === 0;
    const visible = visibleChannelsOf(data);
    const fallback = fallbackCategoriesOf(data);

    return (
        <section className="sync-part">
            {head}
            {failed.map((p) => <Blocker key={p.key} prereq={p} />)}
            {data.onboardingError && (
                <div className="conn-status mid">
                    <Badge tone="mid" icon={<WarnIcon />}>{t("pugOnboarding.blocked")}</Badge>
                    <span>{t("pugOnboarding.onboardingError", { error: data.onboardingError })}</span>
                </div>
            )}
            {data.onboarding && !data.onboarding.enabled && <div className="pug-note">{t("pugOnboarding.onboardingOff")}</div>}

            <div className="pug-cats">
                <div className="pug-group-head">{t("pugOnboarding.categories")}</div>
                {(data.pugCategories || []).map((c) => (
                    <Switch
                        key={c.id}
                        checked={c.selected !== false}
                        disabled={busy}
                        onChange={(on) => switchCategory(c.id, on)}
                        label={(
                            <span>
                                {c.name} <span className="sync-muted">· {c.fallback ? t("pugOnboarding.fallback", { version: roleNameOf(data, `version:${c.versionId}`) }) : roleNameOf(data, `version:${c.versionId}`)}</span>
                            </span>
                        )}
                        tip={c.selected !== false ? t("pugOnboarding.categoryOn") : t("pugOnboarding.categoryOff")}
                    />
                ))}
            </div>
            {none && <div className="sync-empty">{t("pugOnboarding.noneSelected")}</div>}

            {!none && (
                <>
                    <div className="pug-state">
                        <strong>{changes ? t("pugOnboarding.open", { count: changes }) : t("pugOnboarding.allSet")}</strong>
                        <span className="sync-muted">
                            {data.applied && appliedAt
                                ? t("pugOnboarding.lastApplied", { when: formatDateTime(appliedAt), by: data.applied.by })
                                : t("pugOnboarding.neverApplied")}
                        </span>
                    </div>

                    <div className="pug-table">
                        <table className="idx">
                            <thead>
                                <tr>
                                    <SortTh sortKey="what" label={t("pugOnboarding.col.what")} sort={sorted.sort} dir={sorted.dir} onSort={sorted.onSort} />
                                    <SortTh sortKey="want" label={t("pugOnboarding.col.want")} sort={sorted.sort} dir={sorted.dir} onSort={sorted.onSort} />
                                    <SortTh sortKey="have" label={t("pugOnboarding.col.have")} sort={sorted.sort} dir={sorted.dir} onSort={sorted.onSort} />
                                    <SortTh sortKey="status" label={t("pugOnboarding.col.status")} sort={sorted.sort} dir={sorted.dir} onSort={sorted.onSort} />
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.apply(rowsOf(data), sortValueOf).map((row) => {
                                    if (row.kind === "role") return <RoleRow key={row.id} role={row.role} />;
                                    if (row.kind === "prompt") return <PromptRow key={row.id} prompt={row.prompt} />;
                                    return <CategoryRow key={row.id} category={row.category} roleName={roleNameOf(data, row.category.roleKey)} />;
                                })}
                            </tbody>
                        </table>
                    </div>
                    {visible.length > 0 && (
                        <div className="pug-note">{t("pugOnboarding.visibleChannels", { names: visible.map((v) => `${v.category} › ${v.channel}`).join(", ") })}</div>
                    )}
                    {fallback.length > 0 && <div className="pug-note">{t("pugOnboarding.fallbackNote", { names: fallback.join(", ") })}</div>}
                </>
            )}
            {other.length > 0 && <div className="pug-note">{t("pugOnboarding.otherCategories", { names: other.map((c) => c.name).join(", ") })}</div>}

            {preview && <PreviewModal data={data} busy={busy} onClose={() => setPreview(false)} onApply={apply} />}
        </section>
    );
}

function Blocker({ prereq }: { prereq: PugPrerequisite }) {
    const t = useT();
    return (
        <div className="conn-status mid">
            <Badge tone="mid" icon={<WarnIcon />}>{t("pugOnboarding.blocked")}</Badge>
            <span>{t(`pugOnboarding.prereq.${prereq.key}`, { roles: (prereq.roles || []).join(", "), categories: (prereq.categories || []).join(", "), channels: (prereq.channels || []).join(", ") })}</span>
        </div>
    );
}

function Row({ what, want, have, status }: { what: string; want: ReactNode; have: ReactNode; status: PugItemStatus }) {
    return (
        <tr>
            <td className="small">{what}</td>
            <td>{want}</td>
            <td>{have}</td>
            <td><StatusBadge status={status} /></td>
        </tr>
    );
}

/** Why a found role must not be handed out ("hat Discord-Rechte"), "" when it may. */
function usePrivilegedText(role: PugRole): string {
    const t = useT();
    return role.privileged ? t(`pugOnboarding.privileged.${role.privileged.code}`, { detail: role.privileged.detail }) : "";
}

function RoleRow({ role }: { role: PugRole }) {
    const t = useT();
    const why = usePrivilegedText(role);
    return (
        <Row
            what={t(`pugOnboarding.kind.${role.kind}`)}
            want={<span className="pug-role"><Dot color={role.color} />{role.name}</span>}
            have={role.current
                ? (
                    <span>
                        <span className="pug-role"><Dot color={role.current.color} />{role.current.name}</span>
                        {why && <> <Badge tone="bad" size="sm" icon={<WarnIcon />}>{t("pugOnboarding.blocked")}</Badge> <span className="sync-muted">{why}</span></>}
                    </span>
                )
                : <span className="sync-muted">{t("pugOnboarding.missing")}</span>}
            status={role.status}
        />
    );
}

function PromptRow({ prompt }: { prompt: PugPrompt }) {
    const t = useT();
    const foreign = prompt.status === "lost";
    const wanted = prompt.options.filter((o) => o.status !== "lost").length;
    const present = prompt.options.filter((o) => o.status !== "new").length;
    return (
        <Row
            what={t("pugOnboarding.kind.prompt")}
            want={foreign
                ? <span className="sync-muted">–</span>
                : <span>{prompt.title} <span className="sync-muted">· {t("pugOnboarding.answers", { count: wanted })}{prompt.required ? ` · ${t("pugOnboarding.required")}` : ""}</span></span>}
            have={prompt.status === "new"
                ? <span className="sync-muted">{t("pugOnboarding.missing")}</span>
                : <span>{prompt.title} <span className="sync-muted">· {foreign ? t("pugOnboarding.foreign") : t("pugOnboarding.answers", { count: present })}</span></span>}
            status={prompt.status}
        />
    );
}

/** The gaps of a category as text ("für alle sichtbar, Orga sieht sie nicht (Orga)"). */
function gapText(t: ReturnType<typeof useT>, category: PugCategory, roleName: string): string {
    const orga = (category.orga || []).map((o) => o.name).join(", ");
    return category.missing.map((g) => t(`pugOnboarding.gap.${g}`, { role: roleName, roles: orga })).join(", ");
}

function CategoryRow({ category, roleName }: { category: PugCategory; roleName: string }) {
    const t = useT();
    return (
        <Row
            what={t("pugOnboarding.kind.category")}
            want={<span>{category.name} <span className="sync-muted">· {t("pugOnboarding.categoryWant", { role: roleName })}</span></span>}
            have={category.missing.length
                ? <span>{gapText(t, category, roleName)}</span>
                : <span className="sync-muted">{t("pugOnboarding.rightsOk")}</span>}
            status={category.status}
        />
    );
}

function PrivilegedItem({ role }: { role: PugRole }) {
    const why = usePrivilegedText(role);
    return <span className="pug-role"><Dot color={role.current ? role.current.color : role.color} />{role.current ? role.current.name : role.name} <span className="sync-muted">· {why}</span></span>;
}

function PreviewModal({ data, busy, onClose, onApply }: { data: PugOnboardingOverview; busy: boolean; onClose: () => void; onApply: () => void }) {
    const t = useT();
    const p = previewOf(data);
    const lost = p.lostPrompts.length > 0 || p.lostOptions.length > 0;
    const privileged = (data.roles || []).filter((r) => r.privileged);
    const visible = visibleChannelsOf(data);
    return (
        <Modal
            open
            onClose={onClose}
            icon="roster"
            tone="settings"
            kicker={data.guildName}
            title={t("pugOnboarding.preview.title")}
            width={560}
            hint={<AdminOnlyBadge />}
            initialFocus=".pug-preview-cancel"
            footer={(
                <>
                    <Button variant="ghost" className="pug-preview-cancel" icon={<XIcon />} onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
                    <Button variant="go" icon={<SendIcon />} running={busy} disabled={busy || privileged.length > 0} onClick={onApply}>{t("pugOnboarding.apply")}</Button>
                </>
            )}
        >
            <div className="pug-preview">
                {lost && (
                    <div className="conn-status mid">
                        <Badge tone="bad" icon={<WarnIcon />}>{t("pugOnboarding.status.lost")}</Badge>
                        <span>{t("pugOnboarding.preview.lostWarn")}</span>
                    </div>
                )}
                <Group title={t("pugOnboarding.preview.privileged")} lost={false} items={privileged.map((r) => <PrivilegedItem key={r.key} role={r} />)} />
                <Group title={t("pugOnboarding.preview.newRoles")} items={p.newRoles.map((r) => (
                    <span key={r.key} className="pug-role"><Dot color={r.color} />{r.name}{!r.color && <span className="sync-muted"> · {t("pugOnboarding.preview.noColor")}</span>}</span>
                ))} />
                <Group title={t("pugOnboarding.preview.changedRoles")} items={p.changedRoles.map((r) => (
                    <span key={r.key} className="pug-role">
                        {r.current && <><Dot color={r.current.color} />{r.current.name} → </>}
                        <Dot color={r.color} />{r.name}
                    </span>
                ))} />
                <Group title={t("pugOnboarding.preview.categories")} items={p.categories.map((c) => (
                    <span key={c.id}>
                        {c.name} <span className="sync-muted">· {t("pugOnboarding.categoryWant", { role: roleNameOf(data, c.roleKey) })}</span>
                        {(c.synced || []).length > 0 && <span className="sync-muted"> · {t("pugOnboarding.preview.synced", { names: c.synced.map((ch) => ch.name).join(", ") })}</span>}
                    </span>
                ))} />
                <Group title={t("pugOnboarding.preview.prompts")} items={p.prompts.map((x) => (
                    <span key={x.key}>{x.title} <span className="sync-muted">· {t("pugOnboarding.answers", { count: x.options.filter((o) => o.status !== "lost").length })}</span></span>
                ))} />
                <Group title={t("pugOnboarding.preview.lostPrompts")} lost items={p.lostPrompts.map((x) => <span key={x.id}>{x.title}</span>)} />
                <Group title={t("pugOnboarding.preview.lostOptions")} lost items={p.lostOptions.map((o) => <span key={o.id}>{o.title}</span>)} />
                {visible.length > 0 && (
                    <div className="pug-note">{t("pugOnboarding.visibleChannels", { names: visible.map((v) => `${v.category} › ${v.channel}`).join(", ") })}</div>
                )}
                {p.prompts.length > 0 && <div className="pug-note">{t("pugOnboarding.preview.onboardingStays")}</div>}
            </div>
        </Modal>
    );
}

function Group({ title, items, lost = false }: { title: string; items: ReactNode[]; lost?: boolean }) {
    if (!items.length) return null;
    return (
        <div className={`pug-group${lost ? " pug-lost" : ""}`}>
            <div className="pug-group-head">{title}</div>
            <ul>{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
        </div>
    );
}
