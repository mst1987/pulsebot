import { useState } from "react";
import { createSyncKey, deleteSyncKey, type ApiError, type SyncKey, type SyncKeys, type SyncKeyServer } from "../../api";
import { Badge, Button, DataTable, IconButton, RaidLoader, useConfirm, type Column } from "../../components/ui";
import { useToast } from "../../components/shell/Jobs";
import { TrashIcon, CopyIcon, CheckIcon, PlusIcon } from "../../components/ui/icons";
import { formatDate } from "../../lib/format";
import { useTableSort } from "../../lib/ui/tableSort";
import { useT, tOr } from "../../i18n";

/**
 * Sync-App (#1000): personal keys of the sync app, one per device. A key counts
 * for every server its owner is orga of at the time of a request, so the
 * "Gilt für" column is the same for every key of a person: the servers the
 * payload lists right now. The plaintext exists in one answer only, the one
 * that created it, and is shown above the table once; old server keys are
 * managed in the settings and never turn up here.
 */
type SortKey = "name" | "created" | "used";

function serverLabel(s: SyncKeyServer): string {
    return s.label || s.name || s.guildId;
}

export function SyncKeysPart({ data, onChange }: {
    data: SyncKeys | null;
    onChange: (next: SyncKeys) => void;
}) {
    const toast = useToast();
    const ask = useConfirm();
    const t = useT();
    const [name, setName] = useState("");
    const [fresh, setFresh] = useState("");
    const [copied, setCopied] = useState(false);
    const [busy, setBusy] = useState(false);
    const sort = useTableSort<SortKey>("profile-sync-keys-sort", { name: "asc", created: "desc", used: "desc" }, "created");

    if (!data) return <RaidLoader compact text={t("profile.sync.loading")} />;

    const full = data.keys.length >= data.max;

    const create = async () => {
        const device = name.trim();
        if (!device) return;
        setBusy(true);
        try {
            const res = await createSyncKey(device);
            onChange(res);
            setFresh(res.token);
            setCopied(false);
            setName("");
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const revoke = async (key: SyncKey) => {
        if (!(await ask({
            title: t("profile.sync.revokeTitle"),
            text: t("profile.sync.revokeText", { name: key.name }),
            action: t("profile.sync.revoke"),
        }))) return;
        try {
            onChange(await deleteSyncKey(key.id));
            setFresh("");
            toast(t("profile.sync.revoked"));
        } catch (e) {
            toast((e as ApiError).message, "err");
        }
    };

    const servers = data.servers.length
        ? (
            <span className="pf-sync-servers">
                {data.servers.map((s) => (
                    <span key={s.guildId} data-tip={tOr(`profile.sync.role.${s.role}`, "") || undefined}>{serverLabel(s)}</span>
                ))}
            </span>
        )
        : <span className="pf-muted">{t("profile.sync.noServer")}</span>;

    const columns: Column<SyncKey, SortKey>[] = [
        {
            id: "name", label: t("profile.sync.colName"), sortKey: "name",
            cell: (k) => (
                <span className="pf-sync-name">
                    <span className="pf-sync-device" data-tip={k.name}>{k.name}</span>
                    <span className="kicker mono">{t("profile.sync.hint", { hint: k.hint })}</span>
                </span>
            ),
        },
        { id: "servers", label: t("profile.sync.colServers"), cell: () => servers },
        { id: "created", label: t("profile.sync.colCreated"), sortKey: "created", cell: (k) => formatDate(k.createdAt) },
        {
            id: "used", label: t("profile.sync.colLastUsed"), sortKey: "used",
            cell: (k) => (k.lastUsedAt
                ? (
                    <span className="pf-sync-name">
                        {formatDate(k.lastUsedAt)}
                        <span className="kicker">{t("profile.sync.uses", { count: k.uses })}</span>
                    </span>
                )
                : <span className="pf-muted">{t("profile.sync.never")}</span>),
        },
        {
            id: "revoke", label: t("profile.sync.colRevoke"), actions: true, className: "pf-sync-act",
            cell: (k) => <IconButton icon={<TrashIcon />} tone="danger" tip={t("profile.sync.revoke")} onClick={() => revoke(k)} />,
        },
    ];

    const sortValue = (k: SyncKey, key: SortKey) => (key === "name" ? k.name.toLowerCase() : key === "created" ? k.createdAt : k.lastUsedAt);

    return (
        <div className="pf-cal">
            <p className="pf-muted">
                {t("profile.sync.intro")}
                {" "}<strong>{t("profile.sync.secret")}</strong> {t("profile.sync.secretText")}
            </p>

            {fresh && (
                <div className="pf-cal-fresh">
                    <Badge tone="mid">{t("profile.sync.onlyNow")}</Badge>
                    <div className="pf-cal-link">
                        <input type="text" readOnly className="mono" aria-label={t("profile.sync.copy")} value={fresh} onFocus={(e) => e.target.select()} />
                        <IconButton
                            icon={copied ? <CheckIcon /> : <CopyIcon />}
                            tip={copied ? t("profile.sync.copied") : t("profile.sync.copy")}
                            onClick={() => { navigator.clipboard?.writeText(fresh); setCopied(true); }}
                        />
                    </div>
                </div>
            )}

            {!data.allowed && <p className="pf-sync-none">{t("profile.sync.notOrga")}</p>}

            {data.allowed && <form className="pf-sync-new" onSubmit={(e) => { e.preventDefault(); create(); }}>
                <input
                    type="text"
                    value={name}
                    maxLength={60}
                    aria-label={t("profile.sync.device")}
                    placeholder={t("profile.sync.devicePlaceholder")}
                    onChange={(e) => setName(e.target.value)}
                    disabled={full}
                />
                <Button type="submit" variant="go" icon={<PlusIcon />} disabled={busy || full || !name.trim()}>
                    {busy ? t("profile.sync.creating") : t("profile.sync.create")}
                </Button>
            </form>}
            {data.allowed && full && <p className="pf-muted">{t("profile.sync.max", { count: data.max })}</p>}

            <DataTable
                rows={data.keys}
                columns={columns}
                rowKey={(k) => k.id}
                sort={sort}
                sortValue={sortValue}
                wrapClassName="pf-sync-wrap"
                empty={<p className="pf-muted">{t("profile.sync.empty")}</p>}
            />
        </div>
    );
}
