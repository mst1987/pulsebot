// The Kader overview (/kader): one card per Kader of the version shown, before any
// Kader is opened — like the roster overview (RostersPage). A card shows the name,
// the version, how many players stand in each state (Pool → Vorauswahl → Vorläufig →
// Roster, Bench and Tentative small), who leads and how many questions it asks; the
// whole card is a link to the Kader's pool. The Kader opened last carries a small
// badge. Only the server's summary (KaderSummary) is read here: counts and names,
// never wishes, answers or notes.
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { KaderState, KaderSummary, KaderView } from "../../api";
import { Badge, Button, IconTile, PageHead, buttonClass } from "../../components/ui";
import { PlusIcon } from "../../components/ui/icons/icons";
import { useContentVersion } from "../../hooks/useContentVersion";
import { useT } from "../../i18n";
import { leadHue } from "../../lib/kader/leads";
import { AvatarFace, StateIcon } from "./parts";

const CHAIN: KaderState[] = ["pool", "selected", "provisional", "roster"];
const SIDE: KaderState[] = ["bench", "tentative"];

function LeadDots({ kader, view }: { kader: KaderSummary; view: KaderView }) {
    const t = useT();
    if (!kader.leads.length) return <span className="kp-ov-noleads">{t("kader.header.noLeads")}</span>;
    const all = kader.leads.map((id) => view.names[id] || id).join(", ");
    return (
        <span className="kp-ov-leads" role="img" aria-label={`${t("kader.header.leads")}: ${all}`} data-tip={all}>
            {kader.leads.slice(0, 4).map((id) => {
                const hue = leadHue(kader.leads, id);
                return (
                    <span key={id} className={`kp-avatar kp-avatar-sized kp-hue-${hue}`} style={{ "--av": "24px" } as CSSProperties} aria-hidden="true">
                        <AvatarFace view={view} userId={id} name={view.names[id] || "?"} />
                    </span>
                );
            })}
            {kader.leads.length > 4 && <span className="kp-ov-more">+{kader.leads.length - 4}</span>}
        </span>
    );
}

function KaderCard({ kader, view, last }: { kader: KaderSummary; view: KaderView; last: boolean }) {
    const t = useT();
    const { versions } = useContentVersion();
    const versionId = kader.versionId || "";
    const versionLabel = versions.find((v) => v.id === versionId)?.label || versionId;
    return (
        <li>
            <Link className="kp-ov-card" to={`/kader/${encodeURIComponent(kader.id)}/pool`}>
                <div className="kp-ov-top">
                    <IconTile icon="kader" tone="kader" size="lg" />
                    <div className="kp-ov-title">
                        <b>{kader.name}</b>
                        {versionId && (
                            <span className="kp-ov-ver"><i className={`ver-dot ver-${versionId}`} aria-hidden="true" />{versionLabel}</span>
                        )}
                    </div>
                    {last && <Badge tone="accent" className="kp-ov-last">{t("kader.kaders.last")}</Badge>}
                </div>
                <div className="kp-ov-chain" role="group" aria-label={t("kader.nav.kicker")}>
                    {CHAIN.map((s) => (
                        <span key={s} className={`kp-ov-n kp-ov-n-${s}`}>
                            <b>{kader.counts[s] || 0}</b>
                            <span className="kp-ov-lab"><StateIcon state={s} />{t(`kader.state.${s}`)}</span>
                        </span>
                    ))}
                </div>
                <div className="kp-ov-side">
                    {SIDE.map((s) => <span key={s}>{t(`kader.kaders.side.${s}`, { count: kader.counts[s] || 0 })}</span>)}
                </div>
                <div className="kp-ov-foot">
                    <LeadDots kader={kader} view={view} />
                    <span className="kp-ov-q">{t("kader.kaders.questions", { count: kader.questions })}</span>
                    <span className={buttonClass("ghost", "sm", false, "kp-ov-open")}>{t("kader.kaders.open")}</span>
                </div>
            </Link>
        </li>
    );
}

export default function KaderOverview({ view, last, canWrite, onCreate }: { view: KaderView; last: string; canWrite: boolean; onCreate: () => void }) {
    const t = useT();
    return (
        <div className="kp-page kp-ov-page">
            <PageHead
                icon="kader"
                tone="kader"
                kicker={t("kader.kaders.kicker", { count: view.kaders.length })}
                title={t("kader.kaders.title")}
                action={canWrite ? <Button icon={<PlusIcon />} onClick={onCreate}>{t("kader.header.new")}</Button> : undefined}
            />
            <ul className="kp-ov-cards" aria-label={t("kader.kaders.cardsAria")}>
                {view.kaders.map((k) => <KaderCard key={k.id} kader={k} view={view} last={k.id === last} />)}
                {canWrite && (
                    <li>
                        <button type="button" className="kp-ov-card kp-ov-new" onClick={onCreate}>
                            <PlusIcon />
                            <b>{t("kader.header.new")}</b>
                            <span>{t("kader.kaders.newHint")}</span>
                        </button>
                    </li>
                )}
            </ul>
        </div>
    );
}

