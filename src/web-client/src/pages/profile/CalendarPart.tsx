import { useState } from "react";
import { createCalendarToken, revokeCalendarToken, type ApiError, type CalendarToken, type CalendarTokens } from "../../api";
import { Badge, Button, IconButton, RaidLoader, useConfirm } from "../../components/ui";
import { useToast } from "../../components/Jobs";
import { TrashIcon, CopyIcon, CheckIcon } from "../../components/icons";
import { formatDate } from "../../lib/format";
import { useT } from "../../i18n";

/**
 * Kalender-Abo (#312): one link the raider pastes into Outlook, Google or Apple
 * once — every raid they are signed up for turns up in it by itself.
 *
 * The secret exists in exactly one answer, the one that created it: the server
 * keeps only a hash and can never hand it back. So the link is shown here once,
 * with the warning that it is secret, and whoever loses it revokes that row and
 * makes a new one. Nothing is looked up, nothing is shown a second time.
 */
export function CalendarPart({ data, onChange }: {
    data: CalendarTokens | null;
    onChange: (next: CalendarTokens) => void;
}) {
    const toast = useToast();
    const ask = useConfirm();
    const t = useT();
    const [fresh, setFresh] = useState<string>("");
    const [copied, setCopied] = useState(false);
    const [busy, setBusy] = useState(false);

    if (!data) return <RaidLoader compact text={t("profile.cal.loading")} />;

    const create = async () => {
        setBusy(true);
        try {
            const res = await createCalendarToken();
            onChange(res);
            setFresh(res.url);
            setCopied(false);
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const revoke = async (token: CalendarToken) => {
        if (!(await ask({
            title: t("profile.cal.revokeTitle"),
            text: t("profile.cal.revokeText"),
            action: t("profile.cal.revoke"),
        }))) return;
        try {
            const res = await revokeCalendarToken(token.id);
            onChange(res);
            setFresh("");
            toast(t("profile.cal.revoked"));
        } catch (e) {
            toast((e as ApiError).message, "err");
        }
    };

    return (
        <div className="pf-cal">
            <p className="pf-muted">
                {t("profile.cal.intro")}
                {" "}<strong>{t("profile.cal.secret")}</strong> {t("profile.cal.secretText")}
            </p>

            {fresh && (
                <div className="pf-cal-fresh">
                    <Badge tone="mid">{t("profile.cal.onlyNow")}</Badge>
                    <div className="pf-cal-link">
                        <input type="text" readOnly className="mono" value={fresh} onFocus={(e) => e.target.select()} />
                        <IconButton
                            icon={copied ? <CheckIcon /> : <CopyIcon />}
                            tip={copied ? t("profile.cal.copied") : t("profile.cal.copy")}
                            onClick={() => { navigator.clipboard?.writeText(fresh); setCopied(true); }}
                        />
                    </div>
                </div>
            )}

            {data.tokens.map((token) => (
                <div className="pf-cal-row" key={token.id}>
                    <span className="pf-cal-name">
                        {t("profile.cal.link", { hint: token.hint })}
                        <span className="kicker">
                            {t("profile.cal.created", { date: formatDate(token.createdAt) })}
                            {token.lastUsedAt ? t("profile.cal.lastUsed", { date: formatDate(token.lastUsedAt) }) : t("profile.cal.neverUsed")}
                        </span>
                    </span>
                    <IconButton icon={<TrashIcon />} tip={t("profile.cal.revoke")} onClick={() => revoke(token)} />
                </div>
            ))}

            {!data.configured
                ? <p className="pf-muted pf-err">{t("profile.cal.noBaseUrl")}</p>
                : (
                    <Button
                        variant="ghost"
                        onClick={create}
                        disabled={busy || data.tokens.length >= data.max}
                    >
                        {busy ? t("profile.cal.creating") : data.tokens.length ? t("profile.cal.createMore") : t("profile.cal.create")}
                    </Button>
                )}
        </div>
    );
}
