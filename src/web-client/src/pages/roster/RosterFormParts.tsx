// Pieces of the roster form (#657, RosterFormDialog.tsx): Discord roles picked
// from a dropdown (a role the bot cannot give is greyed out with the reason), the
// manager accounts picked through the member search, and the source of the
// first members as four option cards.
import { useEffect, useState, type CSSProperties } from "react";
import { searchRosterMembers, type RosterOptionRole, type RosterOptions, type RosterSource } from "../../api";
import { useApi } from "../../hooks/useApi";
import { useT } from "../../i18n";
import { Button, Chip, WowIcon } from "../../components/ui";
import { PlusIcon, SearchIcon } from "../../components/ui/icons";
import { errorText } from "../../lib/roster/rosterEdit";

const roleDot = (r: RosterOptionRole) => <i className="rn-chip-dot" style={{ "--rc": r.color || "var(--muted)" } as CSSProperties} aria-hidden="true" />;

/**
 * Discord roles picked from a dropdown instead of a wall of chips. `multi`: the
 * picked roles are removable chips (in the order of picking - the first is the
 * roster's main role) and a dropdown + "Hinzufügen" adds one more; single: one
 * dropdown with `noneLabel` as the empty choice. The dropdown lists the server's
 * order (highest first); `requireManageable` greys out a role the bot cannot give.
 */
export function RoleSelect({ roles, value, onChange, multi = true, requireManageable = true, disabled = false, disabledTip, exclude = [], label, noneLabel }: {
    roles: RosterOptionRole[];
    value: string[];
    onChange: (next: string[]) => void;
    multi?: boolean;
    requireManageable?: boolean;
    disabled?: boolean;
    disabledTip?: string;
    exclude?: string[];
    label: string;
    noneLabel?: string;
}) {
    const t = useT();
    const [pick, setPick] = useState("");
    const byId = new Map(roles.map((r) => [r.id, r]));
    const offered = roles
        .filter((r) => !exclude.includes(r.id) && !(multi && value.includes(r.id)))
        .sort((a, b) => b.position - a.position);
    const blocked = (r: RosterOptionRole) => requireManageable && !r.manageable;
    const optionText = (r: RosterOptionRole) => `@${r.name}${blocked(r) ? ` – ${t("roster.form.roleBlocked")}` : ""}`;

    if (!multi) {
        const current = value[0] || "";
        const known = !current || roles.some((r) => r.id === current);
        return (
            <select className="rn-role-select" value={current} disabled={disabled} aria-label={label} data-tip={disabled ? disabledTip : undefined} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}>
                <option value="">{noneLabel || "—"}</option>
                {!known && <option value={current}>{t("roster.form.roleGone")}</option>}
                {offered.map((r) => <option key={r.id} value={r.id} disabled={blocked(r) && r.id !== current}>{optionText(r)}</option>)}
            </select>
        );
    }

    const add = () => {
        if (!pick) return;
        onChange([...value, pick]);
        setPick("");
    };
    return (
        <div className="rn-chip-block" role="group" aria-label={label}>
            <div className="chip-row rn-chips">
                {value.map((id, i) => {
                    const r = byId.get(id);
                    const name = r ? `@${r.name}` : t("roster.form.roleGone");
                    const main = i === 0 && value.length > 1;
                    return (
                        <Chip
                            key={id}
                            tone="accent"
                            icon={r ? roleDot(r) : undefined}
                            tip={main ? t("roster.form.mainRole") : undefined}
                            onRemove={disabled ? undefined : () => onChange(value.filter((v) => v !== id))}
                            removeLabel={t("roster.form.removeRole", { name })}
                        >
                            {name}{main ? ` · ${t("roster.form.main")}` : ""}
                        </Chip>
                    );
                })}
                {!value.length && <span className="rn-sub">{t("roster.form.noRolePicked")}</span>}
            </div>
            {disabled ? (disabledTip ? <p className="rn-sub">{disabledTip}</p> : null) : (
                <div className="rn-role-add">
                    <select className="rn-role-select" value={pick} aria-label={t("roster.form.rolePick", { label })} onChange={(e) => setPick(e.target.value)}>
                        <option value="">{offered.length ? t("roster.form.rolePickPlaceholder") : t("roster.form.noRoles")}</option>
                        {offered.map((r) => <option key={r.id} value={r.id} disabled={blocked(r)}>{optionText(r)}</option>)}
                    </select>
                    <Button variant="ghost" size="sm" icon={<PlusIcon />} disabled={!pick} onClick={add}>{t("roster.form.roleAdd")}</Button>
                </div>
            )}
            {!disabled && offered.some(blocked) && <p className="rn-sub">{t("roster.form.roleBlockedHint")}</p>}
        </div>
    );
}

/** The manager accounts: removable chips and a search over the server's members (without roster). */
export function ManagerAccounts({ users, onChange, versionId, disabled, disabledTip }: {
    users: { userId: string; displayName: string }[];
    onChange: (next: { userId: string; displayName: string }[]) => void;
    versionId: string;
    disabled: boolean;
    disabledTip?: string;
}) {
    const t = useT();
    const [q, setQ] = useState("");
    const [query, setQuery] = useState("");
    useEffect(() => {
        const id = window.setTimeout(() => setQuery(q.trim()), 250);
        return () => window.clearTimeout(id);
    }, [q]);
    const found = useApi(() => searchRosterMembers({ q: query, version: versionId }), [query, versionId], { enabled: !disabled && query.length > 0 });
    const hits = (found.data?.results || []).filter((r) => !users.some((u) => u.userId === r.userId)).slice(0, 8);
    return (
        <div className="rn-chip-block">
            <div className="chip-row rn-chips">
                {users.map((u) => (
                    <Chip key={u.userId} tone="accent" onRemove={disabled ? undefined : () => onChange(users.filter((x) => x.userId !== u.userId))} removeLabel={t("roster.form.removeManager", { name: u.displayName })}>
                        {u.displayName}
                    </Chip>
                ))}
                {!users.length && <span className="rn-sub">{t("roster.form.noManagerUsers")}</span>}
            </div>
            {!disabled && (
                <>
                    <span className="rn-find rn-chip-filter">
                        <SearchIcon />
                        <input type="search" value={q} autoComplete="off" aria-label={t("roster.form.managerSearch")} placeholder={t("roster.form.managerSearch")} onChange={(e) => setQ(e.target.value)} />
                    </span>
                    {found.error && query && <p className="rn-sub">{errorText(found.error)}</p>}
                    {hits.length > 0 && (
                        <div className="chip-row rn-chips" aria-label={t("roster.add.results")}>
                            {hits.map((h) => (
                                <Chip key={h.userId} onClick={() => { onChange([...users, { userId: h.userId, displayName: h.displayName }]); setQ(""); }}>
                                    + {h.displayName}
                                </Chip>
                            ))}
                        </div>
                    )}
                </>
            )}
            {disabled && disabledTip && <p className="rn-sub">{disabledTip}</p>}
        </div>
    );
}

const SOURCES: { id: RosterSource; icon: string }[] = [
    { id: "role", icon: "inv_misc_groupneedmore" },
    { id: "kader", icon: "inv_misc_note_02" },
    { id: "raids", icon: "inv_misc_book_09" },
    { id: "none", icon: "inv_misc_questionmark" },
];

/** Who comes in first: everybody with the role, a Kader, the last raids, or nobody. */
export function SourcePicker({ value, onChange, options, kaderId, onKader, hasCategory, hasRoles }: {
    value: RosterSource;
    onChange: (s: RosterSource) => void;
    options: RosterOptions;
    kaderId: string;
    onKader: (id: string) => void;
    hasCategory: boolean;
    hasRoles: boolean;
}) {
    const t = useT();
    const available = SOURCES.filter((s) => s.id !== "kader" || options.kaders.length > 0);
    const why = (id: RosterSource) => (id === "raids" && !hasCategory ? t("roster.form.source.needsCategory") : id === "role" && !hasRoles ? t("roster.form.source.needsRole") : "");
    return (
        <>
            <div className="rn-src" role="radiogroup" aria-label={t("roster.form.sourceTitle")}>
                {available.map((s) => {
                    const blocked = why(s.id);
                    return (
                        <button
                            key={s.id}
                            type="button"
                            role="radio"
                            aria-checked={value === s.id}
                            className={`rn-src-opt${value === s.id ? " is-on" : ""}`}
                            disabled={!!blocked}
                            data-tip={blocked || undefined}
                            onClick={() => onChange(s.id)}
                        >
                            <WowIcon name={s.icon} size={28} />
                            <b>{t(`roster.form.source.${s.id}`)}</b>
                            <span>{blocked || t(`roster.form.source.${s.id}Sub`)}</span>
                        </button>
                    );
                })}
            </div>
            {value === "kader" && (
                <label className="rn-kader-pick">
                    <span className="rn-lbl">{t("roster.form.kader")}</span>
                    <select value={kaderId} onChange={(e) => onKader(e.target.value)}>
                        <option value="">{t("roster.form.kaderPick")}</option>
                        {options.kaders.map((k) => (
                            <option key={k.id} value={k.id}>{t("roster.form.kaderOption", { name: k.name, count: k.inRoster })}</option>
                        ))}
                    </select>
                </label>
            )}
        </>
    );
}
