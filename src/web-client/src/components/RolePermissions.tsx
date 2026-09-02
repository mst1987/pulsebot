import { useMemo, useState } from "react";
import type { Access, Area, AreaAccess, Role, RolePermissions } from "../api";
import { TrashIcon } from "./icons";

// Editor for the "Berechtigungen" settings tab: per Discord role, per area, a
// read and a write toggle. The stored shape is
// { [roleId]: { [areaId]: { read, write } } } — see src/config/permissions.js;
// the server normalises and enforces it (write always implies read).
//
// Above the roles sit two other grants, both unions with the role rights and so
// both only ever widening — neither can take back what another opens:
//   - the base access ({ [areaId]: { read, write } }): what every logged-in
//     account gets without any role
//   - the per-account grants ({ [userId]: { [areaId]: … } }, same shape as the
//     role map): rights for one named person, for areas that go to people
//     rather than to a group

const EMPTY: AreaAccess = { read: false, write: false };

function grantFor(perms: RolePermissions, roleId: string, areaId: string): AreaAccess {
    const role = perms[roleId];
    return (role && role[areaId]) || EMPTY;
}

/** Toggle one level, keeping "write implies read" true in both directions. */
function toggled(current: AreaAccess, level: "read" | "write"): AreaAccess {
    if (level === "write") {
        const write = !current.write;
        return { write, read: write ? true : current.read };
    }
    const read = !current.read;
    return read ? { read, write: current.write } : { read: false, write: false };
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
    return (
        <label className="switch-row">
            <span className="switch">
                <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} />
                <span className="switch-track"><span className="switch-thumb" /></span>
            </span>
            {label}
        </label>
    );
}

/** The read/write matrix itself — shared by the base access and every role. */
function AreaTable({ areas, grants, onSet }: {
    areas: Area[];
    grants: Record<string, AreaAccess>;
    onSet: (areaId: string, next: AreaAccess) => void;
}) {
    return (
        <table className="perm-table">
            <thead>
                <tr>
                    <th>Bereich</th>
                    <th>Lesen</th>
                    <th>Schreiben</th>
                </tr>
            </thead>
            <tbody>
                {areas.map((area) => {
                    const grant = grants[area.id] || EMPTY;
                    return (
                        <tr key={area.id}>
                            <td>
                                <div>{area.label}</div>
                                <div className="hint">{area.description}</div>
                            </td>
                            <td>
                                <Switch
                                    checked={grant.read}
                                    label="Lesen"
                                    onChange={() => onSet(area.id, toggled(grant, "read"))}
                                />
                            </td>
                            <td>
                                <Switch
                                    checked={grant.write}
                                    label="Schreiben"
                                    onChange={() => onSet(area.id, toggled(grant, "write"))}
                                />
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

/**
 * What every logged-in account may do without holding any of the roles below.
 * Its own card above them, because it is the one grant that applies to people
 * nobody configured — typically read on "Loot-Ansichten" so members can look up
 * what dropped.
 */
function BaseAccessCard({ areas, value, onChange }: {
    areas: Area[];
    value: Access;
    onChange: (next: Access) => void;
}) {
    const granted = areas.filter((a) => (value[a.id] || EMPTY).read || (value[a.id] || EMPTY).write);

    const setGrant = (areaId: string, next: AreaAccess) => {
        const out = { ...value };
        if (!next.read && !next.write) delete out[areaId];
        else out[areaId] = next;
        onChange(out);
    };

    return (
        <div className="sheetcard">
            <div className="row-actions" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <h3 style={{ margin: 0 }}>Basiszugang für alle Angemeldeten</h3>
                <span className="hint">{granted.length ? `${granted.length} Bereich(e)` : "nichts freigegeben"}</span>
            </div>
            <p className="hint">
                Gilt für <b>jedes</b> Discord-Konto, das sich anmeldet — auch ohne Rolle und ohne Mitgliedschaft
                auf dem Server. Das Menü mit Logout ist immer erreichbar; sichtbar wird davon nur, was hier
                freigegeben ist. Rollenrechte kommen oben drauf, nehmen aber nie etwas weg.
            </p>
            <AreaTable
                areas={areas}
                grants={value as Record<string, AreaAccess>}
                onSet={setGrant}
            />
        </div>
    );
}

/**
 * Rights handed to one named Discord account instead of to a role
 * (config.userPermissions). For areas that go to a person, not a group — the
 * loot council is two or three players, and a Discord role for them would only
 * be a second list to keep in sync.
 *
 * Like the base access, this is a union with everything else: it can only ever
 * widen what that account may do.
 */
function UserAccessCard({ userId, name, areas, grants, onSet, onRemove }: {
    userId: string;
    name: string;
    areas: Area[];
    grants: Record<string, AreaAccess>;
    onSet: (areaId: string, next: AreaAccess) => void;
    onRemove: () => void;
}) {
    const readCount = areas.filter((a) => (grants[a.id] || EMPTY).read).length;
    const writeCount = areas.filter((a) => (grants[a.id] || EMPTY).write).length;
    return (
        <div className="sheetcard">
            <div className="row-actions" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <h3 style={{ margin: 0 }}>{name || `Konto ${userId}`}</h3>
                <span className="hint">{readCount} × Lesen · {writeCount} × Schreiben</span>
            </div>
            <div className="row-actions" style={{ marginTop: 4, justifyContent: "space-between" }}>
                <span className="hint">Discord-ID {userId}</span>
                <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}><TrashIcon />Konto entfernen</button>
            </div>
            <AreaTable areas={areas} grants={grants} onSet={onSet} />
        </div>
    );
}

function RoleCard({ role, areas, grants, onSet, onSetAll, onRemove }: {
    role: Role;
    areas: Area[];
    grants: Record<string, AreaAccess>;
    onSet: (areaId: string, next: AreaAccess) => void;
    onSetAll: (level: "read" | "write", on: boolean) => void;
    onRemove: () => void;
}) {
    const readCount = areas.filter((a) => (grants[a.id] || EMPTY).read).length;
    const writeCount = areas.filter((a) => (grants[a.id] || EMPTY).write).length;

    return (
        <div className="sheetcard">
            <div className="row-actions" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <h3 style={{ margin: 0 }}>@{role.name}</h3>
                <span className="hint">{readCount} × Lesen · {writeCount} × Schreiben</span>
            </div>
            <div className="row-actions" style={{ marginTop: 4 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSetAll("read", true)}>Alles lesen</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSetAll("write", true)}>Alles schreiben</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSetAll("read", false)}>Alles abwählen</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}><TrashIcon />Rolle entfernen</button>
            </div>
            <AreaTable areas={areas} grants={grants} onSet={onSet} />
        </div>
    );
}

export default function RolePermissionsEditor({
    areas, roles, adminRoleIds, value, onChange, baseAccess, onBaseAccessChange,
    userPermissions, onUserPermissionsChange, userNames,
}: {
    areas: Area[];
    roles: Role[];
    adminRoleIds: string[];
    value: RolePermissions;
    onChange: (next: RolePermissions) => void;
    baseAccess: Access;
    onBaseAccessChange: (next: Access) => void;
    userPermissions: RolePermissions;
    onUserPermissionsChange: (next: RolePermissions) => void;
    userNames: Record<string, string>;
}) {
    const [picked, setPicked] = useState("");
    const [newUserId, setNewUserId] = useState("");

    // Configured roles first (in the guild's role order), with roles whose id is
    // no longer in the guild kept visible so they can be cleaned up.
    const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
    const configured: Role[] = [
        ...roles.filter((r) => value[r.id]),
        ...Object.keys(value).filter((id) => !roleById.has(id)).map((id) => ({ id, name: `Unbekannte Rolle (${id})` })),
    ];
    const addable = roles.filter((r) => !value[r.id] && !adminRoleIds.includes(r.id));

    const setGrant = (roleId: string, areaId: string, next: AreaAccess) => {
        const grants = { ...(value[roleId] || {}) };
        if (!next.read && !next.write) delete grants[areaId];
        else grants[areaId] = next;
        onChange({ ...value, [roleId]: grants });
    };

    const setAll = (roleId: string, level: "read" | "write", on: boolean) => {
        if (!on) return onChange({ ...value, [roleId]: {} });
        const grants: Record<string, AreaAccess> = {};
        for (const area of areas) grants[area.id] = level === "write" ? { read: true, write: true } : { read: true, write: (value[roleId]?.[area.id] || EMPTY).write };
        onChange({ ...value, [roleId]: grants });
    };

    const removeRole = (roleId: string) => {
        const next = { ...value };
        delete next[roleId];
        onChange(next);
    };

    const addRole = () => {
        if (!picked || value[picked]) return;
        onChange({ ...value, [picked]: {} });
        setPicked("");
    };

    const setUserGrant = (userId: string, areaId: string, next: AreaAccess) => {
        const grants = { ...(userPermissions[userId] || {}) };
        if (!next.read && !next.write) delete grants[areaId];
        else grants[areaId] = next;
        onUserPermissionsChange({ ...userPermissions, [userId]: grants });
    };

    const removeUser = (userId: string) => {
        const next = { ...userPermissions };
        delete next[userId];
        onUserPermissionsChange(next);
    };

    const addUser = () => {
        // Discord ids are 17-20 digit snowflakes; anything else is a typo, and
        // saving it would put a grant on an account that can never log in.
        const id = newUserId.trim();
        if (!/^\d{17,20}$/.test(id) || userPermissions[id]) return;
        onUserPermissionsChange({ ...userPermissions, [id]: {} });
        setNewUserId("");
    };

    const userIds = Object.keys(userPermissions);
    const userIdValid = /^\d{17,20}$/.test(newUserId.trim());

    const base = <BaseAccessCard areas={areas} value={baseAccess} onChange={onBaseAccessChange} />;

    const perUser = (
        <>
            <h3 style={{ marginBottom: 4 }}>Einzelne Konten</h3>
            <p className="hint">
                Rechte für <b>ein bestimmtes Discord-Konto</b> — gedacht für Bereiche, die an benannte Personen
                gehen statt an eine Gruppe (etwa den Loot-Council). Kommt oben drauf wie der Basiszugang und
                nimmt nie etwas weg. Die ID findest du in Discord per Rechtsklick auf den Nutzer →
                „ID kopieren" (Entwicklermodus muss an sein).
            </p>
            <div className="field">
                <label>Konto hinzufügen (Discord-ID)</label>
                <div className="row-actions">
                    <input
                        value={newUserId}
                        onChange={(e) => setNewUserId(e.target.value)}
                        placeholder="z. B. 123456789012345678"
                        inputMode="numeric"
                    />
                    <button type="button" className="btn" onClick={addUser} disabled={!userIdValid || !!userPermissions[newUserId.trim()]}>
                        Hinzufügen
                    </button>
                </div>
                {newUserId.trim() && !userIdValid && <div className="hint">Das sieht nicht nach einer Discord-ID aus (17–20 Ziffern).</div>}
                {userIdValid && userPermissions[newUserId.trim()] && <div className="hint">Dieses Konto ist bereits eingetragen.</div>}
            </div>
            {!userIds.length
                ? <p className="hint">Noch kein einzelnes Konto freigeschaltet.</p>
                : userIds.map((id) => (
                    <UserAccessCard
                        key={id}
                        userId={id}
                        name={userNames[id] || ""}
                        areas={areas}
                        grants={Object.fromEntries(areas.map((a) => [a.id, grantFor(userPermissions, id, a.id)]))}
                        onSet={(areaId, next) => setUserGrant(id, areaId, next)}
                        onRemove={() => removeUser(id)}
                    />
                ))}
        </>
    );

    // The base access needs no Discord roles at all, so it stays editable while
    // the role list is unavailable (bot offline, no server picked).
    if (!roles.length) {
        return (
            <>
                {base}
                {perUser}
                <p className="hint">Keine Rollen geladen (Server gewählt und Bot online?). Die Auswahl ist verfügbar, sobald der Bot verbunden ist.</p>
            </>
        );
    }

    return (
        <>
            {base}
            {perUser}
            <h3 style={{ marginBottom: 4 }}>Rollen</h3>
            <p className="hint">
                Rollen ohne Admin-Rechte bekommen hier gezielt Zugriff auf einzelne Bereiche des Menüs.
                <b> Lesen</b> = Bereich ansehen, <b>Schreiben</b> = dort auch Aktionen ausführen (Schreiben schaltet Lesen automatisch mit).
                Wer mehrere Rollen hat, bekommt die Summe ihrer Rechte. Änderungen greifen für angemeldete Nutzer
                innerhalb von ca. 5 Minuten, ohne erneuten Login.
            </p>
            <p className="hint">
                Admin-Rollen aus dem Tab „Zugang" haben immer vollen Zugriff und tauchen hier nicht auf.
                Die Bereiche „Zugang" und „Berechtigungen" selbst bleiben Voll-Admins vorbehalten — eine Rolle mit
                Schreibrecht auf „Einstellungen" kann sich also keine Rechte selbst vergeben.
            </p>

            <div className="field">
                <label>Rolle hinzufügen</label>
                <div className="row-actions">
                    <select value={picked} onChange={(e) => setPicked(e.target.value)}>
                        <option value="">— Rolle wählen —</option>
                        {addable.map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
                    </select>
                    <button type="button" className="btn" onClick={addRole} disabled={!picked}>Hinzufügen</button>
                </div>
                {!addable.length && <div className="hint">Alle Rollen sind bereits konfiguriert oder sind Admin-Rollen.</div>}
            </div>

            {!configured.length
                ? <p className="hint">Noch keine Rolle mit eingeschränkten Rechten. Oben eine Rolle hinzufügen.</p>
                : configured.map((role) => (
                    <RoleCard
                        key={role.id}
                        role={role}
                        areas={areas}
                        grants={Object.fromEntries(areas.map((a) => [a.id, grantFor(value, role.id, a.id)]))}
                        onSet={(areaId, next) => setGrant(role.id, areaId, next)}
                        onSetAll={(level, on) => setAll(role.id, level, on)}
                        onRemove={() => removeRole(role.id)}
                    />
                ))}
        </>
    );
}
