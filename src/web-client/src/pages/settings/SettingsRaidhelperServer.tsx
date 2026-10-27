import { useEffect, useState } from "react";
import { updateSettings, type ApiError, type RaidhelperServer } from "../../api";
import { useToast } from "../../components/shell/Jobs";
import { Button } from "../../components/ui/Button";
import Switch from "../../components/ui/Switch";
import { FieldLabel } from "../../components/ui/Field";
import { SaveIcon, TrashIcon } from "../../components/ui/icons";
import { useT } from "../../i18n";
import RaidhelperRetirementCard from "./SettingsRaidhelperRetirement";
import RaidhelperSyncCard from "./SettingsRaidhelperSync";

// Einstellungen → Server → Raid-Helper (#927): Raid-Helper per Discord server.
// Off by default; a server without it sends Raid-Helper no request and offers
// only EventHelper. The key is never shown: the page only learns whether there
// is one and its last 4 characters, and can replace or clear it.

const EMPTY: RaidhelperServer = { enabled: false, serverId: "", hasKey: false, keyLast4: "", envKey: false, active: false, at: 0, byName: "" };

type Props = {
    value: RaidhelperServer | null;
    activeGuildId?: string;
    onSaved: (raidhelper: RaidhelperServer) => void;
};

export default function RaidhelperServerSection({ value, activeGuildId, onSaved }: Props) {
    const t = useT();
    const toast = useToast();
    const current = value || EMPTY;
    const [enabled, setEnabled] = useState(current.enabled);
    const [serverId, setServerId] = useState(current.serverId);
    const [newKey, setNewKey] = useState("");
    const [clearKey, setClearKey] = useState(false);
    const [busy, setBusy] = useState(false);
    // the retirement card reads its own state; remount it after a save here
    const [round, setRound] = useState(0);

    useEffect(() => {
        setEnabled(current.enabled);
        setServerId(current.serverId);
    }, [current.enabled, current.serverId]);

    const keyStatus = current.hasKey
        ? current.keyLast4 ? t("settings.raidhelperServer.keyStored", { last4: current.keyLast4 })
            : current.envKey ? t("settings.raidhelperServer.keyEnv") : t("settings.raidhelperServer.keyStoredShort")
        : t("settings.raidhelperServer.keyNone");
    const idValid = /^\d*$/.test(serverId.trim());
    const willHaveKey = clearKey ? !!newKey.trim() : current.hasKey || !!newKey.trim();

    // Only the fields changed here go out: the active server is per session, not
    // per tab, so a stale tab must not overwrite another server's values with
    // the ones it loaded (epic #926).
    const apiKey = newKey.trim() ? newKey.trim() : clearKey ? "" : undefined;
    const patch: { enabled?: boolean; serverId?: string; apiKey?: string } = {};
    if (enabled !== current.enabled) patch.enabled = enabled;
    if (serverId.trim() !== current.serverId) patch.serverId = serverId.trim();
    if (apiKey !== undefined) patch.apiKey = apiKey;
    const dirty = Object.keys(patch).length > 0;

    const save = async () => {
        if (!idValid) { toast(t("settings.raidhelperServer.serverIdInvalid"), "err"); return; }
        if (!dirty) return;
        setBusy(true);
        try {
            // the server this page loaded ("" when none was active): a tab left
            // open after a server switch elsewhere gets 409, not the other server (#921)
            const res = await updateSettings({ raidhelper: patch, serverSettingsGuildId: activeGuildId || "" });
            setNewKey("");
            setClearKey(false);
            if (res.raidhelper) onSaved(res.raidhelper);
            setRound((r) => r + 1);
            toast(t("settings.raidhelperServer.saved"));
        } catch (err) {
            const e = err as ApiError;
            toast(e.code === "server_switched" ? t("settings.serverSwitched") : e.message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rh-server">
            <section className="conn-card" data-conn="raidhelper-server">
                <div className="conn-form rh-server-form">
                    <Switch
                        checked={enabled}
                        onChange={setEnabled}
                        label={t("settings.raidhelperServer.enabled")}
                        tip={t("settings.raidhelperServer.enabledTip")}
                    />
                    <div className="dlg-field">
                        <FieldLabel htmlFor="rh-server-id" tip={t("settings.raidhelperServer.serverId")} tipSub={t("settings.raidhelperServer.serverIdSub")}>
                            {t("settings.raidhelperServer.serverId")}
                        </FieldLabel>
                        <input
                            id="rh-server-id"
                            className="mono"
                            inputMode="numeric"
                            value={serverId}
                            placeholder={activeGuildId || ""}
                            onChange={(e) => setServerId(e.target.value)}
                        />
                        <div className={idValid ? "note" : "note is-bad"}>
                            {idValid ? t("settings.raidhelperServer.serverIdNote") : t("settings.raidhelperServer.serverIdInvalid")}
                        </div>
                    </div>
                    <div className="dlg-field">
                        <FieldLabel htmlFor="rh-server-key" tip={t("settings.raidhelperServer.key")} tipSub={t("settings.raidhelperServer.keySub")}>
                            {t("settings.raidhelperServer.key")}
                        </FieldLabel>
                        <div className="secret-row">
                            <input
                                id="rh-server-key"
                                type="password"
                                className="mono"
                                value={newKey}
                                disabled={clearKey}
                                autoComplete="new-password"
                                placeholder={clearKey ? t("settings.connections.secretCleared") : current.hasKey ? t("settings.connections.secretKeep") : t("settings.connections.secretNone")}
                                onChange={(e) => setNewKey(e.target.value)}
                            />
                            {current.hasKey && !current.envKey && (
                                <Button variant={clearKey ? "ghost" : "danger"} size="sm" icon={clearKey ? undefined : <TrashIcon />} onClick={() => { setClearKey(!clearKey); setNewKey(""); }}>
                                    {clearKey ? t("settings.connections.keep") : t("common.delete")}
                                </Button>
                            )}
                        </div>
                        <div className="note" data-key-status>{keyStatus}</div>
                    </div>
                    {enabled && !willHaveKey && <div className="note is-bad">{t("settings.raidhelperServer.noKeyHint")}</div>}
                </div>
                <div className="conn-foot">
                    <Button variant="go" icon={<SaveIcon />} onClick={save} disabled={busy || !dirty}>
                        {busy ? t("settings.saving") : t("common.save")}
                    </Button>
                </div>
            </section>
            {current.enabled && <RaidhelperSyncCard key={`sync-${round}`} />}
            {current.enabled && <RaidhelperRetirementCard key={`ret-${round}`} />}
        </div>
    );
}
