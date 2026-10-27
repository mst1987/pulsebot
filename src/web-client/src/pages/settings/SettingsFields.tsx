import { useState } from "react";
import { searchSettingsItems, type LogChannelInput, type TopItem, type TextChannel } from "../../api";
import ItemSearchPicker from "../../components/loot/ItemSearchPicker";
import { itemQualityProps } from "../../lib/wow/itemQuality";
import { XIcon, PlusIcon } from "../../components/ui/icons";
import { ChannelPicker } from "../../components/settings/settingsUi";
import { FieldLabel } from "../../components/ui/Field";
import { Button, IconButton } from "../../components/ui/Button";
import { splitList } from "./settingsDraft";
import { useT } from "../../i18n";

// The drops the guild counts as "big". Picked from the live Wowhead search and
// stored with icon + quality, so the dashboard can render an award without
// looking the item up again — and matched against imported loot by item id.
export function TopItemsField({ items, onChange }: {
    items: TopItem[];
    onChange: (items: TopItem[]) => void;
}) {
    const t = useT();
    const add = (it: { id: number; name: string; iconUrl?: string; quality?: number | null }) => {
        if (items.some((x) => x.id === it.id)) return;
        onChange([...items, { id: it.id, name: it.name, iconUrl: it.iconUrl || "", quality: it.quality ?? null }]);
    };

    return (
        <div className="set-field">
            <FieldLabel tip={t("settings.sections.topitems.label")} tipSub={t("settings.fields.topItemsSub")}>{t("settings.fields.addItem")}</FieldLabel>
            <ItemSearchPicker search={searchSettingsItems} onPick={add} />
            {items.length > 0 ? (
                <ul className="topitem-list">
                    {items.map((it) => (
                        <li key={it.id} className="topitem">
                            <span className="topitem-name" data-tip={it.name || t("settings.fields.item", { id: it.id })} data-tip-sub={t("settings.fields.itemId", { id: it.id })}>
                                {it.iconUrl && <img src={it.iconUrl} alt="" loading="lazy" />}
                                <span {...itemQualityProps(it.quality)}>{it.name || t("settings.fields.item", { id: it.id })}</span>
                            </span>
                            <IconButton icon={<XIcon />} tip={t("common.remove")} size="sm" onClick={() => onChange(items.filter((x) => x.id !== it.id))} />
                        </li>
                    ))}
                </ul>
            ) : <div className="empty">{t("settings.fields.noTopItem")}</div>}
        </div>
    );
}

// The log channels of the active server (#921): one row per channel with the
// game version its logs count for. A channel added here has no version yet —
// the server takes it from the channel's category when saving. Built as rows so
// further per-channel choices (#922) can sit next to the version.
const AUTO_VERSION = "__auto";

export function LogChannelsField({ entries, channels, versions, onChange }: {
    entries: LogChannelInput[];
    channels: TextChannel[];
    versions: { id: string; label: string }[];
    onChange: (entries: LogChannelInput[]) => void;
}) {
    const t = useT();
    const [typed, setTyped] = useState("");
    const byId = new Map(channels.map((c) => [c.id, c]));
    const ids = entries.map((e) => e.channelId);
    const add = (raw: string) => {
        const fresh = splitList(raw).filter((id, i, all) => !ids.includes(id) && all.indexOf(id) === i);
        if (fresh.length) onChange([...entries, ...fresh.map((channelId) => ({ channelId }))]);
    };
    // "Aus der Kategorie" is offered only before a version is picked (the server
    // keeps a saved channel's version when it is sent without one).
    const setVersion = (channelId: string, value: string) => {
        if (value !== AUTO_VERSION) onChange(entries.map((e) => (e.channelId === channelId ? { channelId, versionId: value } : e)));
    };
    return (
        <>
            {entries.length > 0 && (
                <ul className="topitem-list logchan-list">
                    {entries.map((e) => {
                        const ch = byId.get(e.channelId);
                        const name = ch ? `#${ch.name}` : e.channelId;
                        return (
                            <li key={e.channelId} className="topitem logchan">
                                <span className="logchan-name" title={ch ? `ID ${e.channelId}` : t("settings.fields.unknownChannel")}>
                                    {ch ? name : <span className="mono">{e.channelId}</span>}
                                    {ch?.category && <small className="muted">{ch.category}</small>}
                                </span>
                                <select
                                    className="logchan-version" aria-label={t("settings.fields.logVersionFor", { name })}
                                    value={e.versionId ?? AUTO_VERSION} onChange={(ev) => setVersion(e.channelId, ev.target.value)}
                                >
                                    {e.versionId === undefined && <option value={AUTO_VERSION}>{t("settings.fields.logVersionAuto")}</option>}
                                    <option value="">{t("settings.fields.logVersionHost")}</option>
                                    {versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                                    {e.versionId && !versions.some((v) => v.id === e.versionId) && <option value={e.versionId}>{e.versionId}</option>}
                                </select>
                                <IconButton
                                    icon={<XIcon />} tip={t("settings.fields.removeChannel")} size="sm"
                                    onClick={() => onChange(entries.filter((x) => x.channelId !== e.channelId))}
                                />
                            </li>
                        );
                    })}
                </ul>
            )}
            {channels.length ? (
                <ChannelPicker value="" channels={channels.filter((c) => !ids.includes(c.id))} onChange={add} placeholder={t("settings.fields.addChannel")} />
            ) : (
                <div className="inline-add">
                    <input type="text" className="mono" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("settings.ui.channelIdPlaceholder")}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(typed); setTyped(""); } }} />
                    <Button variant="ghost" icon={<PlusIcon />} onClick={() => { add(typed); setTyped(""); }} disabled={!typed.trim()}>{t("common.add")}</Button>
                </div>
            )}
        </>
    );
}
