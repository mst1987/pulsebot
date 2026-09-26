import { useState } from "react";
import { searchSettingsItems, type TopItem, type TextChannel } from "../../api";
import ItemSearchPicker from "../../components/loot/ItemSearchPicker";
import { itemQualityProps } from "../../lib/itemQuality";
import { XIcon } from "../../components/icons";
import { ChannelPicker } from "../../components/settings/settingsUi";
import { FieldLabel } from "../../components/ui/Field";
import Chip from "../../components/ui/Chip";
import { Button, IconButton } from "../../components/ui/Button";
import { splitList } from "./settingsDraft";

// The drops the guild counts as "big". Picked from the live Wowhead search and
// stored with icon + quality, so the dashboard can render an award without
// looking the item up again — and matched against imported loot by item id.
export function TopItemsField({ items, onChange }: {
    items: TopItem[];
    onChange: (items: TopItem[]) => void;
}) {
    const add = (it: { id: number; name: string; iconUrl?: string; quality?: number | null }) => {
        if (items.some((x) => x.id === it.id)) return;
        onChange([...items, { id: it.id, name: it.name, iconUrl: it.iconUrl || "", quality: it.quality ?? null }]);
    };

    return (
        <div className="set-field">
            <FieldLabel tip="Top-Items" tipSub="Wird eines dieser Items importiert, taucht es auf dem Dashboard unter „Latest Loot“ auf — mit Charakter, Raid und Datum. Ohne Eintrag bleibt die Karte leer.">Item hinzufügen</FieldLabel>
            <ItemSearchPicker search={searchSettingsItems} onPick={add} />
            {items.length > 0 ? (
                <ul className="topitem-list">
                    {items.map((it) => (
                        <li key={it.id} className="topitem">
                            <span className="topitem-name" data-tip={it.name || `Item ${it.id}`} data-tip-sub={`Item-ID ${it.id}`}>
                                {it.iconUrl && <img src={it.iconUrl} alt="" loading="lazy" />}
                                <span {...itemQualityProps(it.quality)}>{it.name || `Item ${it.id}`}</span>
                            </span>
                            <IconButton icon={<XIcon />} tip="Entfernen" size="sm" onClick={() => onChange(items.filter((x) => x.id !== it.id))} />
                        </li>
                    ))}
                </ul>
            ) : <div className="empty">Noch kein Top-Item.</div>}
        </div>
    );
}

/** Several channels: chips with a remove button, plus a picker (or an id field while the bot is offline). */
export function ChannelListField({ ids, channels, onChange }: {
    ids: string[];
    channels: TextChannel[];
    onChange: (ids: string[]) => void;
}) {
    const [typed, setTyped] = useState("");
    const byId = new Map(channels.map((c) => [c.id, c]));
    const add = (id: string) => {
        const clean = id.trim();
        if (clean && !ids.includes(clean)) onChange([...ids, ...splitList(clean).filter((x) => !ids.includes(x))]);
    };
    return (
        <>
            {ids.length > 0 && (
                <div className="chip-row">
                    {ids.map((id) => (
                        <Chip
                            key={id} tone="accent" tip={byId.get(id) ? `#${byId.get(id)!.name}` : "Unbekannter Kanal"} tipSub={`ID ${id}`}
                            onRemove={() => onChange(ids.filter((x) => x !== id))} removeLabel="Kanal entfernen"
                        >
                            {byId.get(id) ? `#${byId.get(id)!.name}` : <span className="mono">{id}</span>}
                        </Chip>
                    ))}
                </div>
            )}
            {channels.length ? (
                <ChannelPicker value="" channels={channels.filter((c) => !ids.includes(c.id))} onChange={add} placeholder="+ Kanal hinzufügen" />
            ) : (
                <div className="inline-add">
                    <input type="text" className="mono" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Discord-Channel-ID"
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(typed); setTyped(""); } }} />
                    <Button variant="ghost" onClick={() => { add(typed); setTyped(""); }} disabled={!typed.trim()}>Hinzufügen</Button>
                </div>
            )}
        </>
    );
}
