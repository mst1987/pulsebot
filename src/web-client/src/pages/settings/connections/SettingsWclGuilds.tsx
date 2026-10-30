import { useEffect, useState } from "react";
import {
    fetchWclGuild, updateSettings, wclGuildKey, WCL_GUILD_DEFAULT_INTERVAL, WCL_GUILD_INTERVALS, WCL_GUILD_REGIONS,
    type ApiError, type WclGuild, type WclGuildInput,
} from "../../../api";
import { useToast } from "../../../components/shell/Jobs";
import { Button, IconButton } from "../../../components/ui/Button";
import { FieldLabel } from "../../../components/ui/form/Field";
import { PlusIcon, RefreshIcon, SaveIcon, TrashIcon } from "../../../components/ui/icons/icons";
import { agoText } from "../../../lib/settings/settingsLogic";
import { useT } from "../../../i18n";

// Einstellungen → <Server> → Log-Auswertung → Warcraft-Logs-Gilde (#922): one
// row per game version's guild. The server fetches each row's new reports every
// `interval` minutes (Aus = only by the button) and keeps them as logs of this
// server and version, like a link posted in a log channel. Saved on its own
// (only this list goes out, with the server the page loaded).

type Props = {
    value: WclGuild[];
    activeGuildId: string;
    versions: { id: string; label: string }[];
    onSaved: (list: WclGuild[]) => void;
};

const inputOf = (e: WclGuildInput): WclGuildInput => ({
    versionId: e.versionId, guildName: e.guildName, realm: e.realm, region: e.region, interval: e.interval,
});
const sameRows = (a: WclGuildInput[], b: WclGuildInput[]) => JSON.stringify(a.map(inputOf)) === JSON.stringify(b.map(inputOf));

export default function WclGuildsSection({ value, activeGuildId, versions, onSaved }: Props) {
    const t = useT();
    const toast = useToast();
    const [rows, setRows] = useState<WclGuildInput[]>(() => value.map(inputOf));
    const [busy, setBusy] = useState(false);
    const [fetching, setFetching] = useState<string>("");
    const [now, setNow] = useState(() => Date.now());

    // reset the rows only when the stored list really changed (saved, fetched with
    // other names, server switched) — not on every parent render with a new array
    const savedKey = JSON.stringify(value.map(inputOf));
    useEffect(() => { setRows(JSON.parse(savedKey) as WclGuildInput[]); }, [savedKey]);
    // "vor 12 Min" ages while the page stays open
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 60000);
        return () => window.clearInterval(id);
    }, []);

    const savedByKey = new Map(value.map((e) => [wclGuildKey(e), e]));
    const dirty = !sameRows(rows, value);
    const valid = rows.every((r) => r.versionId && r.guildName.trim() && r.realm.trim());

    const setRow = (i: number, patch: Partial<WclGuildInput>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const add = () => setRows([...rows, {
        versionId: versions[0]?.id || "", guildName: "", realm: "", region: "EU", interval: WCL_GUILD_DEFAULT_INTERVAL,
    }]);

    const failText = (err: unknown) => {
        const e = err as ApiError;
        return e.code === "server_switched" ? t("settings.serverSwitched") : e.message;
    };

    const save = async () => {
        if (!valid) { toast(t("settings.wclGuilds.incomplete"), "err"); return; }
        setBusy(true);
        try {
            const res = await updateSettings({ wclGuilds: rows.map(inputOf), serverSettingsGuildId: activeGuildId });
            onSaved(res.wclGuilds || []);
            toast(t("settings.wclGuilds.saved"));
        } catch (err) {
            toast(failText(err), "err");
        } finally {
            setBusy(false);
        }
    };

    const fetchNow = async (key: string) => {
        if (fetching) return;
        setFetching(key);
        try {
            const res = await fetchWclGuild(key, activeGuildId);
            onSaved(res.wclGuilds);
            setNow(Date.now());
            if (res.result.error) toast(res.result.error, "err");
            else toast(t("settings.wclGuilds.fetched", { count: res.result.found }));
        } catch (err) {
            toast(failText(err), "err");
        } finally {
            setFetching("");
        }
    };

    const intervalLabel = (m: number) => (m === 0 ? t("settings.wclGuilds.intervalOff")
        : m < 60 ? t("settings.wclGuilds.intervalMinutes", { count: m }) : t("settings.wclGuilds.intervalHours", { count: m / 60 }));

    const lastText = (saved: WclGuild | undefined) => {
        if (!saved || !saved.lastResult) return t("settings.wclGuilds.never");
        const ago = agoText(saved.lastResult.at, now);
        if (saved.lastResult.error) return `${ago} · ${saved.lastResult.error}`;
        return `${ago} · ${t("settings.wclGuilds.found", { count: saved.lastResult.found })}`;
    };

    return (
        <div className="set-field wclg" data-section="wcl-guilds">
            <FieldLabel tip={t("settings.wclGuilds.title")} tipSub={t("settings.wclGuilds.titleSub")}>{t("settings.wclGuilds.title")}</FieldLabel>
            {rows.length > 0 ? (
                <div className="table-scroll">
                    <table className="idx wclg-table">
                        <thead>
                            <tr>
                                <th>{t("settings.wclGuilds.version")}</th>
                                <th>{t("settings.wclGuilds.guild")}</th>
                                <th>{t("settings.wclGuilds.realm")}</th>
                                <th>{t("settings.wclGuilds.region")}</th>
                                <th>{t("settings.wclGuilds.interval")}</th>
                                <th>{t("settings.wclGuilds.last")}</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => {
                                const key = wclGuildKey(r);
                                const saved = savedByKey.get(key);
                                // only a stored row can be fetched (the server reads it from the settings)
                                const canFetch = !!saved && saved.interval === r.interval;
                                const n = i + 1;
                                return (
                                    <tr key={i}>
                                        <td>
                                            <select aria-label={t("settings.wclGuilds.versionFor", { n })} value={r.versionId} onChange={(e) => setRow(i, { versionId: e.target.value })}>
                                                {versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                                                {r.versionId && !versions.some((v) => v.id === r.versionId) && <option value={r.versionId}>{r.versionId}</option>}
                                            </select>
                                        </td>
                                        <td>
                                            <input aria-label={t("settings.wclGuilds.guildFor", { n })} value={r.guildName} maxLength={64}
                                                onChange={(e) => setRow(i, { guildName: e.target.value })} />
                                        </td>
                                        <td>
                                            <input aria-label={t("settings.wclGuilds.realmFor", { n })} value={r.realm} maxLength={64}
                                                placeholder="Thunderstrike" onChange={(e) => setRow(i, { realm: e.target.value })} />
                                        </td>
                                        <td>
                                            <select aria-label={t("settings.wclGuilds.regionFor", { n })} value={r.region} onChange={(e) => setRow(i, { region: e.target.value })}>
                                                {WCL_GUILD_REGIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                                            </select>
                                        </td>
                                        <td>
                                            <select aria-label={t("settings.wclGuilds.intervalFor", { n })} value={r.interval} onChange={(e) => setRow(i, { interval: Number(e.target.value) })}>
                                                {WCL_GUILD_INTERVALS.map((m) => <option key={m} value={m}>{intervalLabel(m)}</option>)}
                                            </select>
                                        </td>
                                        <td className={saved?.lastResult?.error ? "small wclg-last is-bad" : "small wclg-last"} data-last={key}>
                                            {lastText(saved)}
                                        </td>
                                        <td className="cell-act">
                                            <Button
                                                variant="ghost" size="sm" icon={<RefreshIcon />}
                                                running={fetching === key}
                                                disabled={!canFetch || !!fetching}
                                                data-tip={canFetch ? t("settings.wclGuilds.fetchTip") : t("settings.wclGuilds.saveFirst")}
                                                onClick={() => { void fetchNow(key); }}
                                            >
                                                {t("settings.wclGuilds.fetch")}
                                            </Button>
                                            <IconButton icon={<TrashIcon />} tip={t("common.delete")} size="sm" tone="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : <p className="muted">{t("settings.wclGuilds.empty")}</p>}
            <div className="wclg-foot">
                <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={add} disabled={!versions.length}>{t("settings.wclGuilds.add")}</Button>
                <Button variant="go" icon={<SaveIcon />} onClick={() => { void save(); }} disabled={busy || !dirty}>
                    {busy ? t("settings.saving") : t("settings.wclGuilds.save")}
                </Button>
            </div>
        </div>
    );
}
