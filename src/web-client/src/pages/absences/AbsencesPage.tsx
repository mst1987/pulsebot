// Roster › Abwesenheiten (October 2026): who is away when over the next weeks —
// from "Abwesend eintragen" and from raids signed off one by one — what that
// does to the coming raids, and who keeps signing off without saying for how
// long. Three views: the timeline (default), one card per raid, and a raider
// in the side drawer. The server builds everything (GET /api/availability/
// overview, src/services/signups/absenceOverview.js); the layout rules are
// lib/absences.ts. The raid lead enters an absence for a raider through the
// signup page's dialog (components/signup/AvailabilityDialog.tsx).
import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getAbsenceOverview, getAvailability, type AbsenceIdentity, type RaiderRef } from "../../api";
import { useApi } from "../../hooks/useApi";
import { usePersistedState } from "../../lib/persistedState";
import { visibleRaiders } from "../../lib/absences";
import { Button, IconTile, Segment, Switch } from "../../components/ui";
import RaidLoader from "../../components/ui/RaidLoader";
import { MenuRailPage } from "../../components/SectionRail";
import { AbsenceIcon, SearchIcon } from "../../components/icons";
import AvailabilityDialog from "../../components/signup/AvailabilityDialog";
import type { ShellContext } from "../../components/Shell";
import { useT } from "../../i18n";
import AbsenceTimeline from "./AbsenceTimeline";
import AbsenceRaids from "./AbsenceRaids";
import RaiderDrawer from "./RaiderDrawer";
import { AbsenceTiles, HintCard } from "./AbsenceHead";
import "../../styles/absences.css";

type ViewMode = "timeline" | "raids";
type Span = "4" | "8" | "13";
type View = { mode: ViewMode; category: string; span: Span; presence: boolean };

const VIEW_DEFAULT: View = { mode: "timeline", category: "", span: "8", presence: true };
const SPANS: Span[] = ["4", "8", "13"];

/** A stored view from an older build or by hand: only known values are read. */
function cleanView(v: Partial<View>): View {
    return {
        mode: v.mode === "raids" ? "raids" : "timeline",
        category: typeof v.category === "string" ? v.category : "",
        span: SPANS.includes(v.span as Span) ? (v.span as Span) : "8",
        presence: v.presence !== false,
    };
}

/** Whom the dialog enters for: a raider of the page, as the dialog's picker names them. */
function refOf(who: Pick<AbsenceIdentity, "userId" | "name" | "character" | "classId">): RaiderRef {
    return { userId: who.userId, name: who.name, character: who.character, className: who.classId };
}

export default function AbsencesPage() {
    const { user } = useOutletContext<ShellContext>();
    return <MenuRailPage user={user} parent="roster"><Absences /></MenuRailPage>;
}

function Absences() {
    const t = useT();
    const [stored, setStored] = usePersistedState<View>("absences-view", VIEW_DEFAULT);
    const view = cleanView(stored);
    const patch = (p: Partial<View>) => setStored(() => ({ ...view, ...p }));
    const [search, setSearch] = useState("");
    const [drawer, setDrawer] = useState("");
    // bumped after a save in the dialog, so an open drawer loads the raider again
    const [saved, setSaved] = useState(0);
    // the dialog: closed (null), or open for nobody yet / for a raider
    const [dialog, setDialog] = useState<{ target: RaiderRef | null } | null>(null);

    const overview = useApi(() => getAbsenceOverview(Number(view.span), view.category), [view.span, view.category]);
    const data = overview.data;
    // The dialog needs the caller's own availability (and whether they are orga) — only for whoever may enter.
    const own = useApi(() => getAvailability(), [], { enabled: !!data?.canEdit });

    // The categories seen so far: a filtered answer only names its own category,
    // and the segment must keep offering the others.
    const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
    useEffect(() => {
        if (!data) return;
        setCategories((prev) => {
            const known = new Map(prev.map((c) => [c.id, c]));
            // a raid without a category has the id "" — that is "Alle", not an option of its own
            for (const c of data.categories) if (c.id) known.set(c.id, c);
            return [...known.values()];
        });
    }, [data]);

    if (overview.error && !data) return <div className="empty">{t("absences.loadError", { message: overview.error.message })}</div>;
    if (!data) return <RaidLoader text={t("absences.loading")} />;

    const rows = visibleRaiders(data.raiders, { presence: view.presence, search });
    const canEnter = data.canEdit && !!own.data;
    const enter = (target: RaiderRef | null) => setDialog({ target });

    return (
        <div className="ab-page">
            <div className="page-head">
                <IconTile icon="achievement_guildperk_everybodysfriend" tone="roster" size="lg" />
                <div className="ph-text">
                    <div className="kicker">{t("absences.kicker")}</div>
                    <h1>{t("absences.title")}</h1>
                    <p className="ab-lead">{t("absences.lead")}</p>
                </div>
                <div className="ph-act">
                    <Segment<ViewMode>
                        ariaLabel={t("absences.viewAria")}
                        value={view.mode}
                        onChange={(mode) => patch({ mode })}
                        options={[
                            { value: "timeline", label: t("absences.view.timeline") },
                            { value: "raids", label: t("absences.view.raids") },
                        ]}
                    />
                    {data.canEdit && (
                        <Button icon={<AbsenceIcon />} disabled={!canEnter} onClick={() => enter(null)}>{t("absences.enter")}</Button>
                    )}
                </div>
            </div>

            <AbsenceTiles data={data} />

            <div className="ab-filters">
                {categories.length > 1 && (
                    <Segment<string>
                        ariaLabel={t("absences.filter.categoryAria")}
                        value={view.category}
                        onChange={(category) => patch({ category })}
                        options={[{ value: "", label: t("common.all") }, ...categories.map((c) => ({ value: c.id, label: c.name || c.id }))]}
                    />
                )}
                <Segment<Span>
                    ariaLabel={t("absences.filter.spanAria")}
                    value={view.span}
                    onChange={(span) => patch({ span })}
                    options={[
                        { value: "4", label: t("absences.filter.weeks", { count: 4 }) },
                        { value: "8", label: t("absences.filter.weeks", { count: 8 }) },
                        { value: "13", label: t("absences.filter.months", { count: 3 }) },
                    ]}
                />
                {view.mode === "timeline" && (
                    <>
                        <Switch checked={view.presence} onChange={(presence) => patch({ presence })} label={t("absences.filter.presence")} tip={t("absences.filter.presenceTip")} />
                        <label className="ab-search">
                            <SearchIcon />
                            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                                placeholder={t("absences.filter.searchPlaceholder")} aria-label={t("absences.filter.searchAria")} />
                        </label>
                    </>
                )}
            </div>

            {view.mode === "timeline" ? (
                <>
                    {data.hints.map((h) => (
                        <HintCard key={`${h.userId}-${h.categoryId}`} hint={h} canEdit={canEnter} onOpen={setDrawer} onEnter={(x) => enter(refOf(x))} />
                    ))}
                    <AbsenceTimeline data={data} rows={rows} onOpen={setDrawer} />
                    <Legend />
                </>
            ) : <AbsenceRaids data={data} onOpen={setDrawer} />}

            {drawer && (
                <RaiderDrawer
                    key={`${drawer}-${saved}`}
                    userId={drawer}
                    onClose={() => setDrawer("")}
                    onEnter={(raider) => enter(refOf(raider))}
                    onChanged={() => { void overview.reload(); }}
                />
            )}
            {own.data && (
                <AvailabilityDialog
                    kind={dialog ? "absence" : null}
                    own={own.data}
                    target={dialog ? dialog.target : null}
                    onClose={() => setDialog(null)}
                    onSaved={() => { void overview.reload(); setSaved((n) => n + 1); }}
                />
            )}
        </div>
    );
}

function Legend() {
    const t = useT();
    return (
        <ul className="ab-legend" aria-label={t("absences.legend.aria")}>
            <li><i className="ab-lg-long" aria-hidden="true" />{t("absences.legend.long")}</li>
            <li><i className="ab-lg-short" aria-hidden="true" />{t("absences.legend.short")}</li>
            <li><i className="ab-lg-single" aria-hidden="true" />{t("absences.legend.single")}</li>
            <li><i className="ab-lg-presence" aria-hidden="true" />{t("absences.legend.presence")}</li>
            <li><i className="ab-lg-today" aria-hidden="true" />{t("absences.legend.today")}</li>
        </ul>
    );
}
