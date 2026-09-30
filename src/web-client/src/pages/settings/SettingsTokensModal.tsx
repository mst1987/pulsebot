import { useState } from "react";
import {
    createIngestToken, deleteIngestToken, createKaderToken, deleteKaderToken,
    type ApiError, type IngestToken,
} from "../../api";
import { fmtMs } from "../../lib/format";
import { useTableSort, type Dir } from "../../lib/tableSort";
import { SortTh } from "../../components/SortTh";
import { useToast } from "../../components/Jobs";
import { useConfirm, Modal } from "../../components/ui/Modal";
import { Button, IconButton } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import { CheckIcon, CopyIcon, TrashIcon } from "../../components/icons";
import { AdminOnlyBadge, WarnIcon } from "../../components/settings/settingsUi";
import { FieldLabel } from "../../components/ui/Field";
import RaidLoader from "../../components/ui/RaidLoader";
import { tParts, useT } from "../../i18n";

// The token list of one machine credential (Einstellungen → Verbindungen):
// mint one (its secret shown exactly once, with a copy button), revoke one
// behind a confirm. Two kinds share it — the loot-sync uploader's tokens (ehl_)
// and the local Kaderbau app's (ehk_, docs/kaderbau.md); each has its own API
// and its own texts, the table is the same.

export type TokenKind = "loot" | "kader";

type KindConfig = {
    create: (name: string) => Promise<{ token: string; record: IngestToken }>;
    remove: (id: string) => Promise<{ id: string }>;
    prefix: string;
    icon: string;
    sortStore: string;
    /** i18n keys that differ between the kinds; the rest is shared under settings.tokens. */
    title: string;
    revokeText: string;
    colUses: string;
    newSub: string;
};

const TOKEN_KINDS: Record<TokenKind, KindConfig> = {
    loot: {
        create: createIngestToken,
        remove: deleteIngestToken,
        prefix: "ehl_",
        icon: "inv_misc_punchcards_blue",
        sortStore: "settings-ingest-tokens-sort",
        title: "settings.tokens.title",
        revokeText: "settings.tokens.revokeText",
        colUses: "settings.tokens.colUploads",
        newSub: "settings.tokens.newSub",
    },
    kader: {
        create: createKaderToken,
        remove: deleteKaderToken,
        prefix: "ehk_",
        icon: "inv_misc_groupneedmore",
        sortStore: "settings-kader-tokens-sort",
        title: "settings.kaderTokens.title",
        revokeText: "settings.kaderTokens.revokeText",
        colUses: "settings.kaderTokens.colUses",
        newSub: "settings.kaderTokens.newSub",
    },
};

type TokenSortKey = "name" | "created" | "lastUsed" | "uses";
const TOKEN_SORT_DEFAULTS: Record<TokenSortKey, Dir> = { name: "asc", created: "desc", lastUsed: "desc", uses: "desc" };

export default function TokensModal({ kind = "loot", open, tokens, onClose, onChanged }: {
    kind?: TokenKind;
    open: boolean;
    tokens: IngestToken[] | null;
    onClose: () => void;
    onChanged: () => void;
}) {
    const cfg = TOKEN_KINDS[kind];
    const ask = useConfirm();
    const toast = useToast();
    const t = useT();
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    // The plaintext of the token just created — only in this state, gone on reload.
    const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
    const [copied, setCopied] = useState(false);

    const close = () => { setFresh(null); setCopied(false); onClose(); };

    const create = async () => {
        setBusy(true);
        try {
            const r = await cfg.create(name);
            setFresh({ token: r.token, name: r.record.name });
            setName("");
            setCopied(false);
            onChanged();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const revoke = async (tok: IngestToken) => {
        if (!(await ask({ title: t("settings.tokens.revokeAsk", { name: tok.name }), text: t(cfg.revokeText), action: t("settings.tokens.revoke"), tone: "danger" }))) return;
        try {
            await cfg.remove(tok.id);
            onChanged();
            toast(t("settings.tokens.revoked", { name: tok.name }));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    // Default "zuletzt benutzt": the question this table answers is usually
    // "welcher Rechner benutzt ihn eigentlich noch?".
    const { sort, dir, onSort, apply } = useTableSort<TokenSortKey>(cfg.sortStore, TOKEN_SORT_DEFAULTS, "lastUsed");
    const sorted = apply(tokens || [], (tok, key) => {
        switch (key) {
            case "name": return tok.name.toLowerCase();
            case "created": return tok.createdAt || 0;
            case "uses": return tok.uses || 0;
            default: return tok.lastUsedAt || 0;
        }
    });
    const inputId = `token-name-${kind}`;

    return (
        <Modal
            open={open}
            onClose={close}
            icon={cfg.icon}
            tone="settings"
            kicker={t("settings.editKicker")}
            title={t(cfg.title)}
            width={720}
            hint={<AdminOnlyBadge />}
            footer={<Button variant="ghost" onClick={close}>{t("common.done")}</Button>}
        >
            <div className="conn-form">
                {fresh && (
                    <div className="conn-status mid">
                        <Badge tone="mid" icon={<WarnIcon />}>{t("settings.tokens.onceVisible")}</Badge>
                        <div className="fresh-token">
                            <span>{tParts("settings.tokens.created", { name: fresh.name })}</span>
                            <div className="secret-row">
                                <input type="text" readOnly className="mono" aria-label={t("settings.tokens.copy")} value={fresh.token} onFocus={(e) => e.target.select()} />
                                <IconButton
                                    icon={copied ? <CheckIcon /> : <CopyIcon />}
                                    tip={copied ? t("common.copied") : t("settings.tokens.copy")}
                                    onClick={() => { navigator.clipboard?.writeText(fresh.token); setCopied(true); }}
                                />
                            </div>
                        </div>
                    </div>
                )}
                <div className="dlg-field">
                    <FieldLabel htmlFor={inputId} tip={t("settings.tokens.new")} tipSub={t(cfg.newSub)}>{t("settings.tokens.new")}</FieldLabel>
                    <div className="secret-row">
                        <input id={inputId} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("settings.tokens.namePlaceholder")} />
                        <Button icon={cfg.icon} onClick={create} disabled={busy}>{busy ? t("settings.tokens.creating") : t("settings.tokens.create")}</Button>
                    </div>
                </div>
                {!tokens ? <RaidLoader compact text={t("settings.tokens.loading")} /> : !tokens.length ? (
                    <div className="empty">{t("settings.tokens.empty")}</div>
                ) : (
                    <div className="table-scroll">
                        <table className="idx">
                            <thead>
                                <tr>
                                    <SortTh sortKey="name" label={t("common.name")} sort={sort} dir={dir} onSort={onSort} />
                                    <th data-tip={t("settings.tokens.colToken")} data-tip-sub={t("settings.tokens.colTokenSub")}>{t("settings.tokens.colToken")}</th>
                                    <SortTh sortKey="created" label={t("settings.tokens.colCreated")} sort={sort} dir={dir} onSort={onSort} />
                                    <SortTh sortKey="lastUsed" label={t("settings.tokens.colLastUsed")} sort={sort} dir={dir} onSort={onSort} />
                                    <SortTh sortKey="uses" label={t(cfg.colUses)} sort={sort} dir={dir} onSort={onSort} />
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((tok) => (
                                    <tr key={tok.id}>
                                        <td><strong>{tok.name}</strong></td>
                                        <td className="mono">{cfg.prefix}…{tok.hint}</td>
                                        <td className="small" data-tip={tok.createdBy ? t("settings.tokens.createdBy", { name: tok.createdBy }) : undefined}>{fmtMs(tok.createdAt)}</td>
                                        <td className="small">{tok.lastUsedAt ? fmtMs(tok.lastUsedAt) : t("settings.tokens.never")}</td>
                                        <td className="mono">{tok.uses || 0}</td>
                                        <td className="cell-act">
                                            <IconButton icon={<TrashIcon />} tip={t("settings.tokens.revokeTip")} size="sm" tone="danger" onClick={() => revoke(tok)} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </Modal>
    );
}
