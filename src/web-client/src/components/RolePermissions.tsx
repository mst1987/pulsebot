import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Access, Area, Role, RolePermissions } from "../api";
import {
    LEVEL_LABEL, areaCounts, isDiscordId, levelOf, nextLevel, withLevel, type Grants, type Level,
} from "../lib/settingsLogic";
import { Button, IconButton } from "./ui/Button";
import { Modal } from "./ui/Modal";
import Badge from "./ui/Badge";
import Segment from "./ui/Segment";
import PartHead from "./ui/PartHead";
import WowIcon from "./ui/WowIcon";
import { TrashIcon, XIcon } from "./icons";
import { EyeIcon, InfoTip, LockIcon, PenIcon, PlusIcon, FieldLabel } from "./settingsUi";

// Einstellungen → Berechtigungen as one matrix: rows = who, columns = the areas
// of the menu, each cell one tri-state button (aus › Lesen › Schreiben). It
// replaces a stack of cards with a table of switches per role — around 160
// switches on seven screens, where two roles could not be compared at all.
//
// Grouped by owner: the full admins (their roles as badges; they get everything),
// the base access every logged-in account gets, the roles, and single accounts.
// All grants are unions — a row only ever widens what someone may do. The stored
// shapes (adminRoleIds, rolePermissions, baseAccess, userPermissions, see
// src/config/permissions.js) do not change; the server normalises them again.

/** The WoW icon of each area's column — the same icons as the shell's menu. */
const AREA_ICONS: Record<string, string> = {
    dashboard: "achievement_zone_outland_01",
    recruitment: "inv_misc_grouplooking",
    cla: "inv_misc_pocketwatch_01",
    raids: "inv_misc_note_02",
    roster: "achievement_guildperk_everybodysfriend",
    history: "inv_misc_book_09",
    loot: "inv_misc_bag_10",
    lootcouncil: "inv_misc_coin_02",
    channels: "inv_letter_15",
    settings: "trade_engineering",
};

type RowKind = "base" | "role" | "user";

/** One tri-state cell. The tooltip names row, area and what the next click does. */
function TriStateCell({ owner, area, level, onSet }: {
    owner: string;
    area: Area;
    level: Level;
    onSet: (level: Level) => void;
}) {
    const next = nextLevel(level);
    return (
        <button
            type="button"
            className={`perm-cell lv-${level}`}
            aria-label={`${owner} · ${area.label}: ${LEVEL_LABEL[level]}`}
            data-tip={`${owner} · ${area.label}`}
            data-tip-sub={`${LEVEL_LABEL[level]} — Klick schaltet auf ${LEVEL_LABEL[next]}`}
            onClick={() => onSet(next)}
        >
            {level === "write" ? <PenIcon /> : level === "read" ? <EyeIcon /> : <span aria-hidden="true">–</span>}
        </button>
    );
}

/** The row head: a click opens the three row-wide actions. */
function RowName({ label, sub, avatar, onAll }: {
    label: string;
    sub: string;
    avatar: ReactNode;
    onAll: (level: Level) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return undefined;
        const close = (e: MouseEvent | KeyboardEvent) => {
            if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", close);
        document.addEventListener("keydown", close);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("keydown", close);
        };
    }, [open]);

    return (
        <div className="perm-who" ref={ref}>
            {avatar}
            <button type="button" className="perm-who-name" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
                data-tip={label} data-tip-sub="Klick: ganze Zeile auf Lesen, Schreiben oder aus setzen">
                <span className="perm-who-label">{label}</span>
                <span className="perm-who-sub">{sub}</span>
            </button>
            {open && (
                <div className="split-menu perm-menu" role="menu">
                    {(["read", "write", "none"] as Level[]).map((lv) => (
                        <button key={lv} type="button" role="menuitem" onClick={() => { setOpen(false); onAll(lv); }}>
                            {lv === "read" ? "Alles lesen" : lv === "write" ? "Alles schreiben" : "Alles abwählen"}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function GroupRow({ span, label, tip, tipSub, aside }: { span: number; label: string; tip: string; tipSub: string; aside?: ReactNode }) {
    return (
        <tr className="perm-group">
            <td colSpan={span}>
                <div className="perm-group-head">
                    <span>{label}</span>
                    <InfoTip head={tip} sub={tipSub} />
                    {aside && <span className="perm-group-aside">{aside}</span>}
                </div>
            </td>
        </tr>
    );
}

function grantSummary(areas: Area[], grants: Grants | undefined): string {
    let read = 0;
    let write = 0;
    for (const a of areas) {
        const lv = levelOf(grants?.[a.id]);
        if (lv === "read") read += 1;
        if (lv === "write") write += 1;
    }
    if (!read && !write) return "nichts freigegeben";
    return `${read} × Lesen · ${write} × Schreiben`;
}

export default function RolePermissionsEditor({
    areas, roles, adminRoleIds, onAdminRoleIds, value, onChange, baseAccess, onBaseAccessChange,
    userPermissions, onUserPermissionsChange, userNames, icon, crumb,
}: {
    areas: Area[];
    roles: Role[];
    adminRoleIds: string[];
    onAdminRoleIds: (next: string[]) => void;
    value: RolePermissions;
    onChange: (next: RolePermissions) => void;
    baseAccess: Access;
    onBaseAccessChange: (next: Access) => void;
    userPermissions: RolePermissions;
    onUserPermissionsChange: (next: RolePermissions) => void;
    userNames: Record<string, string>;
    icon: string;
    crumb: string;
}) {
    const [adding, setAdding] = useState<null | "grant" | "admin">(null);
    const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
    const roleName = (id: string) => (roleById.get(id) ? `@${roleById.get(id)!.name}` : `Unbekannte Rolle (${id})`);

    // Configured roles in the guild's role order, then ids the guild no longer
    // has — kept visible so they can be cleaned up instead of lingering unseen.
    const roleIds = [
        ...roles.filter((r) => value[r.id]).map((r) => r.id),
        ...Object.keys(value).filter((id) => !roleById.has(id)),
    ];
    const userIds = Object.keys(userPermissions);
    const span = areas.length + 2;

    const setRole = (roleId: string, grants: Grants) => onChange({ ...value, [roleId]: grants as RolePermissions[string] });
    const setUser = (userId: string, grants: Grants) => onUserPermissionsChange({ ...userPermissions, [userId]: grants as RolePermissions[string] });
    const allOf = (level: Level): Grants => {
        let out: Grants = {};
        for (const a of areas) out = withLevel(out, a.id, level);
        return out;
    };

    const cells = (kind: RowKind, id: string, owner: string, grants: Grants | undefined) => areas.map((area) => (
        <td key={area.id} className="perm-td">
            <TriStateCell
                owner={owner}
                area={area}
                level={levelOf(grants?.[area.id])}
                onSet={(lv) => {
                    const next = withLevel(grants, area.id, lv);
                    if (kind === "base") onBaseAccessChange(next);
                    else if (kind === "role") setRole(id, next);
                    else setUser(id, next);
                }}
            />
        </td>
    ));

    const columnMaps: Grants[] = [baseAccess, ...Object.values(value), ...Object.values(userPermissions)];

    return (
        <>
            <PartHead
                icon={icon}
                tone="settings"
                title="Berechtigungen"
                crumb={`Einstellungen › ${crumb}`}
                action={<Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={() => setAdding("grant")}>Rolle oder Konto</Button>}
            />
            <div className="perm-legend">
                <span className="note">Klick schaltet</span>
                <span className="perm-cell lv-none" aria-hidden="true"><span>–</span></span><span className="note">aus</span>
                <span className="note perm-sep">›</span>
                <span className="perm-cell lv-read" aria-hidden="true"><EyeIcon /></span><span className="note">Lesen</span>
                <span className="note perm-sep">›</span>
                <span className="perm-cell lv-write" aria-hidden="true"><PenIcon /></span><span className="note">Schreiben</span>
                <span className="grow" />
                <Badge tone="accent" tip="Rechte addieren sich" tipSub="Wer mehrere Rollen hat, bekommt die Summe ihrer Rechte; Basiszugang und einzelne Konten kommen oben drauf und nehmen nie etwas weg. Änderungen greifen für angemeldete Nutzer innerhalb von ca. 5 Minuten.">
                    Rechte addieren sich über alle Rollen
                </Badge>
            </div>

            <div className="perm-card table-scroll">
                <table className="idx perm-matrix">
                    <colgroup>
                        <col className="perm-col-who" />
                        {areas.map((a) => <col key={a.id} className="perm-col" />)}
                        <col className="perm-col-act" />
                    </colgroup>
                    <thead>
                        <tr>
                            <th>Wer</th>
                            {areas.map((a) => {
                                const counts = areaCounts(columnMaps, a.id);
                                return (
                                    <th key={a.id} className="perm-th" data-tip={a.label} data-tip-sub={`${a.description}\nLesen: ${counts.read} · Schreiben: ${counts.write}`} tabIndex={0}>
                                        <WowIcon name={AREA_ICONS[a.id] || "inv_misc_questionmark"} size={26} />
                                    </th>
                                );
                            })}
                            <th aria-label="Aktionen" />
                        </tr>
                    </thead>
                    <tbody>
                        <GroupRow
                            span={span}
                            label="Voll-Admins"
                            tip="Voll-Admins"
                            tipSub="Mitglieder mit einer dieser Rollen haben jeden Bereich mit Schreibrecht und als Einzige Zugriff auf Berechtigungen und Verbindungs-Secrets. Änderungen greifen innerhalb von ca. 5 Minuten ohne erneuten Login."
                            aside={<Badge icon={<LockIcon />}>alles · Schreiben</Badge>}
                        />
                        <tr className="perm-admins">
                            <td colSpan={span}>
                                <div className="perm-admin-list">
                                    {adminRoleIds.map((id) => (
                                        <button
                                            key={id}
                                            type="button"
                                            className="badge accent perm-admin-role"
                                            data-tip={`${roleName(id)} entfernen`}
                                            data-tip-sub={`Rollen-ID ${id}`}
                                            onClick={() => onAdminRoleIds(adminRoleIds.filter((x) => x !== id))}
                                        >
                                            {roleName(id)}<XIcon />
                                        </button>
                                    ))}
                                    <button type="button" className="badge perm-add-admin" onClick={() => setAdding("admin")} disabled={!roles.length}
                                        data-tip={roles.length ? "Admin-Rolle hinzufügen" : "Keine Rollen geladen"} data-tip-sub={roles.length ? undefined : "Server gewählt und Bot online? Die Auswahl ist verfügbar, sobald der Bot verbunden ist."}>
                                        <PlusIcon />Admin-Rolle
                                    </button>
                                    <span className="grow" />
                                    <span className="note" data-tip="Notfall-Zugang" data-tip-sub="Die ADMIN_USER_ID aus der .env behält immer vollen Zugang, egal was hier steht.">
                                        Notfall-Zugang über ADMIN_USER_ID bleibt immer bestehen
                                    </span>
                                </div>
                            </td>
                        </tr>

                        <GroupRow
                            span={span}
                            label="Alle Angemeldeten"
                            tip="Basiszugang"
                            tipSub="Gilt für jedes Discord-Konto, das sich anmeldet — auch ohne Rolle und ohne Mitgliedschaft auf dem Server. Das Menü mit Logout ist immer erreichbar; sichtbar wird nur, was hier freigegeben ist."
                        />
                        <tr>
                            <td>
                                <RowName label="Basiszugang" sub="ohne Rolle, auch Gäste" avatar={<span className="perm-avatar round">∗</span>} onAll={(lv) => onBaseAccessChange(allOf(lv))} />
                            </td>
                            {cells("base", "base", "Basiszugang", baseAccess)}
                            <td />
                        </tr>

                        <GroupRow
                            span={span}
                            label="Rollen"
                            tip="Rollen"
                            tipSub="Rollen ohne Admin-Rechte bekommen hier gezielt Zugriff auf einzelne Bereiche. Lesen = ansehen, Schreiben = dort auch handeln. Berechtigungen und Admin-Rollen bleiben Voll-Admins vorbehalten — eine Rolle mit Schreibrecht auf Einstellungen kann sich keine Rechte selbst geben."
                        />
                        {!roleIds.length && (
                            <tr><td colSpan={span} className="perm-empty">
                                {roles.length ? "Noch keine Rolle mit eigenen Rechten — über „Rolle oder Konto“ hinzufügen." : "Keine Rollen geladen (Server gewählt und Bot online?)."}
                            </td></tr>
                        )}
                        {roleIds.map((id) => {
                            const role = roleById.get(id);
                            const name = roleName(id);
                            return (
                                <tr key={id} className={role ? undefined : "perm-unknown"}>
                                    <td>
                                        <RowName
                                            label={name}
                                            sub={role ? grantSummary(areas, value[id]) : "nicht mehr auf dem Server"}
                                            avatar={<span className="perm-avatar" style={role?.color ? { "--rc": role.color } as CSSProperties : undefined}>@</span>}
                                            onAll={(lv) => setRole(id, allOf(lv))}
                                        />
                                    </td>
                                    {cells("role", id, name, value[id])}
                                    <td className="cell-act">
                                        <IconButton icon={<TrashIcon />} tip={`${name} entfernen`} size="sm" tone="danger" onClick={() => {
                                            const next = { ...value };
                                            delete next[id];
                                            onChange(next);
                                        }} />
                                    </td>
                                </tr>
                            );
                        })}

                        <GroupRow
                            span={span}
                            label="Einzelne Konten"
                            tip="Einzelne Konten"
                            tipSub="Rechte für ein bestimmtes Discord-Konto — für Bereiche, die an benannte Personen gehen statt an eine Gruppe (etwa den Loot-Council). Kommt oben drauf wie der Basiszugang und nimmt nie etwas weg."
                        />
                        {!userIds.length && (
                            <tr><td colSpan={span} className="perm-empty">Noch kein einzelnes Konto freigeschaltet.</td></tr>
                        )}
                        {userIds.map((id) => {
                            const name = userNames[id] || `Konto ${id.slice(-4)}`;
                            return (
                                <tr key={id}>
                                    <td>
                                        <RowName
                                            label={name}
                                            sub={`Discord · ${id}`}
                                            avatar={<span className="perm-avatar round">{name.slice(0, 1).toUpperCase()}</span>}
                                            onAll={(lv) => setUser(id, allOf(lv))}
                                        />
                                    </td>
                                    {cells("user", id, name, userPermissions[id])}
                                    <td className="cell-act">
                                        <IconButton icon={<TrashIcon />} tip={`${name} entfernen`} size="sm" tone="danger" onClick={() => {
                                            const next = { ...userPermissions };
                                            delete next[id];
                                            onUserPermissionsChange(next);
                                        }} />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {adding && (
                <AddOwnerModal
                    mode={adding}
                    roles={roles}
                    taken={adding === "admin" ? adminRoleIds : [...Object.keys(value), ...adminRoleIds]}
                    takenUsers={userIds}
                    onClose={() => setAdding(null)}
                    onAddRole={(roleId) => {
                        if (adding === "admin") onAdminRoleIds([...adminRoleIds, roleId]);
                        else onChange({ ...value, [roleId]: {} });
                        setAdding(null);
                    }}
                    onAddUser={(userId) => {
                        onUserPermissionsChange({ ...userPermissions, [userId]: {} });
                        setAdding(null);
                    }}
                />
            )}
        </>
    );
}

/** "Rolle oder Konto": pick a role, or enter a Discord id (checked as a snowflake). */
function AddOwnerModal({ mode, roles, taken, takenUsers, onClose, onAddRole, onAddUser }: {
    mode: "grant" | "admin";
    roles: Role[];
    taken: string[];
    takenUsers: string[];
    onClose: () => void;
    onAddRole: (roleId: string) => void;
    onAddUser: (userId: string) => void;
}) {
    const [kind, setKind] = useState<"role" | "user">(roles.length || mode === "admin" ? "role" : "user");
    const [roleId, setRoleId] = useState("");
    const [userId, setUserId] = useState("");
    const addable = roles.filter((r) => !taken.includes(r.id));
    const trimmed = userId.trim();
    const idValid = isDiscordId(trimmed);
    const duplicate = idValid && takenUsers.includes(trimmed);
    const canAdd = kind === "role" ? !!roleId : idValid && !duplicate;

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_scroll_11"
            tone="settings"
            kicker="Berechtigungen"
            title={mode === "admin" ? "Admin-Rolle hinzufügen" : "Rolle oder Konto hinzufügen"}
            width={480}
            initialFocus="select, input"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button disabled={!canAdd} onClick={() => (kind === "role" ? onAddRole(roleId) : onAddUser(trimmed))}>Hinzufügen</Button>
                </>
            )}
        >
            <div className="conn-form">
                {mode === "grant" && (
                    <Segment
                        ariaLabel="Art"
                        value={kind}
                        onChange={(v) => setKind(v === "user" ? "user" : "role")}
                        options={[
                            { value: "role", label: "Discord-Rolle", disabled: !roles.length, tip: roles.length ? undefined : "Keine Rollen geladen" },
                            { value: "user", label: "Einzelnes Konto" },
                        ]}
                    />
                )}
                {kind === "role" ? (
                    <div className="dlg-field">
                        <FieldLabel htmlFor="perm-add-role" tip="Rolle" tipSub={mode === "admin" ? "Mitglieder mit dieser Rolle erhalten vollen Admin-Zugang." : "Die Rolle startet ohne Rechte; die Zellen der neuen Zeile schalten sie frei."}>Rolle</FieldLabel>
                        <select id="perm-add-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                            <option value="">— Rolle wählen —</option>
                            {addable.map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
                        </select>
                        {!addable.length && <div className="note">Alle Rollen sind bereits eingetragen.</div>}
                    </div>
                ) : (
                    <div className="dlg-field">
                        <FieldLabel htmlFor="perm-add-user" tip="Discord-ID" tipSub="In Discord per Rechtsklick auf den Nutzer → „ID kopieren“ (Entwicklermodus muss an sein).">Discord-ID</FieldLabel>
                        <input id="perm-add-user" className="mono" inputMode="numeric" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="z. B. 123456789012345678" />
                        {trimmed && !idValid && <div className="note is-bad">Das sieht nicht nach einer Discord-ID aus (17–20 Ziffern).</div>}
                        {duplicate && <div className="note is-bad">Dieses Konto ist bereits eingetragen.</div>}
                    </div>
                )}
            </div>
        </Modal>
    );
}
