import { useMemo, useState } from "react";
import type { Area, AreaAccess, Role, RolePermissions } from "../api";

// Editor for the "Berechtigungen" settings tab: per Discord role, per area, a
// read and a write toggle. The stored shape is
// { [roleId]: { [areaId]: { read, write } } } — see src/config/permissions.js;
// the server normalises and enforces it (write always implies read).

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
                <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>Rolle entfernen</button>
            </div>
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
        </div>
    );
}

export default function RolePermissionsEditor({ areas, roles, adminRoleIds, value, onChange }: {
    areas: Area[];
    roles: Role[];
    adminRoleIds: string[];
    value: RolePermissions;
    onChange: (next: RolePermissions) => void;
}) {
    const [picked, setPicked] = useState("");

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

    if (!roles.length) {
        return <p className="hint">Keine Rollen geladen (Server gewählt und Bot online?). Die Auswahl ist verfügbar, sobald der Bot verbunden ist.</p>;
    }

    return (
        <>
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
                    <button type="button" className="btn btn-sm" onClick={addRole} disabled={!picked}>Hinzufügen</button>
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
