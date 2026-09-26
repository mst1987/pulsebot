import { useEffect, useState } from "react";
import { getRaiderCharacters, saveRaiderCharacters, type ApiError, type RaiderCharactersData } from "../../api";
import { useToast } from "../../components/Jobs";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import RaidLoader from "../../components/ui/RaidLoader";

// Raider → Charakter for exactly one category (see raiderCharactersStore.js):
// which character a raider plays on that raid day. Overrides the automatic
// "last known spec" guess on the Raid-Detail attendance tab. Used to be a
// section of its own with a second category picker; it now opens from the
// category's row, so the category is a prop, not a choice.

export default function RaiderCharactersModal({ categoryId, categoryName, onClose, onSaved }: {
    categoryId: string;
    categoryName: string;
    onClose: () => void;
    onSaved: (info: RaiderCharactersData) => void;
}) {
    const [info, setInfo] = useState<RaiderCharactersData | null>(null);
    const [draftMap, setDraftMap] = useState<Record<string, string>>({});
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const toast = useToast();

    useEffect(() => {
        getRaiderCharacters(categoryId)
            .then((d) => { setInfo(d); setDraftMap(d.assignments); })
            .catch((err: ApiError) => setLoadError(err.message));
    }, [categoryId]);

    const save = async () => {
        if (!info) return;
        setSaving(true);
        try {
            const { assignments } = await saveRaiderCharacters(categoryId, draftMap);
            const next = { ...info, assignments };
            toast(`Zuordnung für ${categoryName} gespeichert.`);
            onSaved(next);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    const open = info ? info.members.filter((m) => !(draftMap[m.id] || "").trim()).length : 0;

    return (
        <Modal
            open
            onClose={onClose}
            icon="ability_rogue_disguise"
            tone="settings"
            kicker={`Raider → Charakter · ${categoryName}`}
            title="Charaktere zuordnen"
            width={620}
            hint={info && info.members.length ? <Badge tone={open ? "mid" : "ok"}>{open ? `${open} offen` : "alle fest"}</Badge> : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={saving}>Abbrechen</Button>
                    <Button onClick={save} disabled={saving || !info || !info.members.length}>{saving ? "Speichert…" : "Speichern"}</Button>
                </>
            )}
        >
            {loadError && <div className="empty is-bad">{loadError}</div>}
            {!loadError && !info && <RaidLoader compact text="Charaktere werden geladen" />}
            {info && !info.roleIds.length && (
                <div className="empty">Dieser Kategorie sind noch keine Raider-Rollen zugeordnet — erst in der Zeile Rollen wählen und speichern.</div>
            )}
            {info && info.membersError && <div className="empty is-bad">Mitglieder konnten nicht geladen werden: {info.membersError}</div>}
            {info && !!info.roleIds.length && !info.membersError && (
                !info.members.length ? <div className="empty">Keine Mitglieder mit den zugeordneten Rollen gefunden.</div> : (
                    <div className="rch-list">
                        {info.members.map((m) => (
                            <label className="rch-row" key={m.id}>
                                <span className="rch-name">{m.displayName}</span>
                                <input
                                    type="text"
                                    list="raider-characters-known"
                                    value={draftMap[m.id] || ""}
                                    onChange={(e) => setDraftMap({ ...draftMap, [m.id]: e.target.value })}
                                    placeholder="Charname (leer = automatisch)"
                                />
                            </label>
                        ))}
                        <datalist id="raider-characters-known">
                            {info.knownCharacters.map((c) => <option key={c} value={c} />)}
                        </datalist>
                    </div>
                )
            )}
        </Modal>
    );
}
