import { useState } from "react";
import { getKaderTokens } from "../../api";
import { useApi } from "../../hooks/useApi";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import IconTile from "../../components/ui/IconTile";
import { AdminOnlyBadge } from "../../components/settings/settingsUi";
import { InfoTip } from "../../components/ui/Field";
import { fmtMs } from "../../lib/format";
import { useT } from "../../i18n";
import TokensModal from "./SettingsTokensModal";

// Einstellungen → Verbindungen: the card of the local Kaderbau app (roster
// builder, docs/kaderbau.md). It reads GET /api/kader/export with a token of its
// own (ehk_) — minted and revoked here, the secret shown exactly once. The card
// loads its tokens itself: they feed nothing else on the page, and an optional
// tool must not count as "nicht eingerichtet" in the section badge.

export default function KaderbauCard() {
    const t = useT();
    const [open, setOpen] = useState(false);
    const tokensData = useApi(() => getKaderTokens().then((r) => r.tokens), []);
    const tokens = tokensData.error ? null : tokensData.data;
    const icon = "inv_misc_groupneedmore";
    const lastUsed = (tokens || []).filter((tok) => tok.lastUsedAt).sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];

    return (
        <section className="conn-card" data-conn="kaderbau">
            <div className="conn-head">
                <IconTile icon={icon} tone="settings" />
                <div className="conn-title">
                    <span>{t("settings.kaderTokens.cardTitle")}</span>
                    <InfoTip head={t("settings.kaderTokens.cardTip")} sub={t("settings.kaderTokens.cardSub")} />
                </div>
                <Badge tone={tokens && tokens.length ? "accent" : undefined}>
                    {tokens ? t("settings.state.tokenCount", { count: tokens.length }) : t("settings.state.tokens")}
                </Badge>
            </div>
            <dl className="conn-rows">
                <div>
                    <dt>{t("settings.kaderTokens.lastUse")}</dt>
                    <dd>{lastUsed ? `${fmtMs(lastUsed.lastUsedAt)} · ${lastUsed.name}` : tokens ? t("settings.kaderTokens.noUseYet") : "—"}</dd>
                </div>
                <div>
                    <dt>{t("settings.kaderTokens.endpoint")}</dt>
                    <dd className="mono">/api/kader/export</dd>
                </div>
            </dl>
            <div className="conn-foot">
                <AdminOnlyBadge />
                <span className="grow" />
                <Button variant="ghost" size="sm" icon={icon} onClick={() => setOpen(true)}>
                    {t("settings.connections.manageTokens")}
                </Button>
            </div>
            <TokensModal
                kind="kader"
                open={open}
                tokens={tokens}
                onClose={() => setOpen(false)}
                onChanged={() => { void tokensData.reload(); }}
            />
        </section>
    );
}
