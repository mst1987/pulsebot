import { useApi } from "../../hooks/useApi";
import { assignGuildBank, deleteGuildBank, getGuildBankSettings, type ApiError, type GuildBankAdminRow, type GuildBankSettings } from "../../api";
import { useToast } from "../../components/Jobs";
import { IconButton } from "../../components/ui/Button";
import { useConfirm } from "../../components/ui/Modal";
import Badge from "../../components/ui/Badge";
import IconTile from "../../components/ui/IconTile";
import RaidLoader from "../../components/ui/RaidLoader";
import { InfoTip } from "../../components/ui/Field";
import { CheckMark, WarnIcon } from "../../components/settings/settingsUi";
import { TrashIcon } from "../../components/icons";
import { formatDateTime } from "../../lib/format";
import { tParts, useT } from "../../i18n";

// Einstellungen → Verbindungen → "Gildenbanken" (#632): every guild bank the
// sync tool uploaded, the ones waiting for a server first. A bank belongs to
// an event server — that is where its stock page and the requests are; with a
// single event server a new bank lands there by itself (#631's ingest), with
// several it waits here. "Keinem Server" takes an assignment back.

const nameOf = (bank: GuildBankAdminRow) => `${bank.guild} · ${bank.realm}`;

export default function GuildBanksCard() {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const state = useApi<GuildBankSettings>(() => getGuildBankSettings(), []);
    const data = state.data;

    const assign = async (bank: GuildBankAdminRow, guildId: string) => {
        try {
            await assignGuildBank(bank.key, guildId);
            const server = data?.servers.find((s) => s.guildId === guildId);
            toast(guildId
                ? t("settings.guildBanks.assigned", { name: nameOf(bank), server: (server && (server.label || server.name)) || guildId })
                : t("settings.guildBanks.unassigned", { name: nameOf(bank) }));
            await state.reload();
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    const remove = async (bank: GuildBankAdminRow) => {
        const ok = await ask({
            title: t("settings.guildBanks.deleteTitle", { name: nameOf(bank) }),
            text: t("settings.guildBanks.deleteText"),
            action: t("common.delete"),
            tone: "danger",
        });
        if (!ok) return;
        try {
            await deleteGuildBank(bank.key);
            toast(t("settings.guildBanks.deleted", { name: nameOf(bank) }));
            await state.reload();
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    const pending = data ? data.pending : 0;
    return (
        <section className="conn-card rhr-card" data-conn="guild-banks">
            <div className="conn-head">
                <IconTile icon="achievement_guildperk_mobilebanking" tone={pending ? "mid" : "bank"} />
                <div className="conn-title">
                    <span>{t("settings.guildBanks.title")}</span>
                    <InfoTip head={t("settings.guildBanks.title")} sub={t("settings.guildBanks.infoSub")} />
                </div>
                {data && data.banks.length > 0 && (
                    <Badge tone={pending ? "mid" : "ok"} icon={pending ? <WarnIcon /> : <CheckMark />}>
                        {pending ? tParts("settings.guildBanks.waiting", { count: pending }) : t("settings.guildBanks.allAssigned")}
                    </Badge>
                )}
            </div>
            {!data ? (
                state.error ? <div className="note rhr-pad">{state.error.message}</div> : <RaidLoader compact text={t("settings.guildBanks.loading")} />
            ) : !data.banks.length ? (
                <div className="note rhr-pad">{t("settings.guildBanks.none")}</div>
            ) : (
                <ul className="rhr-list">
                    {data.banks.map((bank) => (
                        <li className="rhr-item gbs-item" key={bank.key}>
                            <span className="gbs-name">
                                <Badge size="sm">{bank.gameVersion.toUpperCase()}</Badge>
                                <b>{nameOf(bank)}</b>
                            </span>
                            <span className="rhr-value">
                                {t("settings.guildBanks.scanned", { date: formatDateTime(bank.scannedAt), count: bank.counts.items })}
                            </span>
                            <span className="gbs-server">
                                {bank.pending && <Badge tone="mid" size="sm">{t("settings.guildBanks.waitingBadge")}</Badge>}
                                <select
                                    className="gbs-select"
                                    aria-label={t("settings.guildBanks.serverAria", { name: nameOf(bank) })}
                                    value={bank.guildId}
                                    onChange={(e) => { void assign(bank, e.target.value); }}
                                >
                                    <option value="">{t("settings.guildBanks.noServer")}</option>
                                    {data.servers.map((s) => <option key={s.guildId} value={s.guildId}>{s.label || s.name || s.guildId}</option>)}
                                </select>
                            </span>
                            <span className="rhr-act">
                                <IconButton icon={<TrashIcon />} size="sm" tone="danger" tip={t("settings.guildBanks.delete")} onClick={() => { void remove(bank); }} />
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
