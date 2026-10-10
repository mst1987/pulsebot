// Abwesenheiten (October 2026), a menu entry of its own under "Start": who is
// away when over the next weeks — from "Abwesend eintragen" and from raids
// signed off one by one — and each raider's own attendance.
//
//   Zeitleiste, Pro Raid   the orga's overview (area "roster"): GET /api/availability/
//                          overview (src/services/signups/absenceOverview.js), a raider
//                          in the side drawer; layout rules in lib/roster/absences.ts
//   Meine Anwesenheit      everybody with "signup": the own entries and the quota per
//                          raid category and raid (MyAttendance.tsx); `?userId=` is
//                          the same view for one raider, opened by the orga from the drawer
//
// A raider without "roster" sees only "Meine Anwesenheit". Entering goes
// through the signup page's dialog (components/signup/AvailabilityDialog.tsx).
import { useState, type ReactNode } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { canAccess, getAbsenceOverview, getAvailability, type AbsenceIdentity, type RaiderRef } from "../../api";
import { useApi } from "../../hooks/useApi";
import { usePersistedState } from "../../lib/ui/persistedState";
import { categoryTone, visibleRaiders } from "../../lib/roster/absences";
import { Button, IconTile, Segment, Switch } from "../../components/ui";
import Chip from "../../components/ui/Chip";
import RaidLoader from "../../components/ui/RaidLoader";
import { AbsenceIcon, SearchIcon } from "../../components/ui/icons";
import AvailabilityDialog from "../../components/signup/AvailabilityDialog";
import type { ShellContext } from "../../components/shell/Shell";
import { useT } from "../../i18n";
import AbsenceTimeline from "./AbsenceTimeline";
import AbsenceRaids from "./AbsenceRaids";
import RaiderDrawer from "./RaiderDrawer";
import MyAttendance from "./MyAttendance";
import { OrgaZone } from "../../components/ui/OrgaZone";
import { AbsenceTiles, HintCard } from "./AbsenceHead";
import "../../styles/absences.css";

type ViewMode = "timeline" | "raids" | "mine";
type Span = "4" | "8" | "13";
type View = { mode: ViewMode; category: string; span: Span; presence: boolean };

const VIEW_DEFAULT: View = { mode: "timeline", category: "", span: "8", presence: true };
const SPANS: Span[] = ["4", "8", "13"];
const MODES: ViewMode[] = ["timeline", "raids", "mine"];

/** A stored view from an older build or by hand: only known values are read. */
function cleanView(v: Partial<View>): View {
    return {
        mode: MODES.includes(v.mode as ViewMode) ? (v.mode as ViewMode) : "timeline",
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
    const t = useT();
    const { user } = useOutletContext<ShellContext>();
    const orgaView = canAccess(user, "roster");
    const [stored, setStored] = usePersistedState<View>("absences-view", VIEW_DEFAULT);
    const view = cleanView(stored);
    const patch = (p: Partial<View>) => setStored(() => ({ ...view, ...p }));
    const [params, setParams] = useSearchParams();
    // a raider's attendance, opened from the drawer: the orga's view of one raider
    const raider = params.get("userId") || "";
    const mode: ViewMode = !orgaView || raider ? "mine" : view.mode;

    const viewSwitch = orgaView && !raider ? (
        <Segment<ViewMode>
            ariaLabel={t("absences.viewAria")}
            value={mode}
            onChange={(m) => patch({ mode: m })}
            options={[
                { value: "timeline", label: t("absences.view.timeline") },
                { value: "raids", label: t("absences.view.raids") },
                { value: "mine", label: t("absences.view.mine") },
            ]}
        />
    ) : null;

    if (mode === "mine") {
        return (
            <div className="ab-page">
                <Head lead={raider ? t("absences.mine.leadRaider") : t("absences.mine.lead")}>{viewSwitch}</Head>
                <MyAttendance key={raider} userId={raider} onBack={raider ? () => setParams({}) : undefined} />
            </div>
        );
    }
    return <OrgaViews user={user} view={view} patch={patch} viewSwitch={viewSwitch} onAttendance={(id) => setParams({ userId: id })} />;
}

function Head({ lead, children }: { lead: string; children?: ReactNode }) {
    const t = useT();
    return (
        <div className="page-head">
            <IconTile icon="spell_nature_timestop" tone="absences" size="lg" />
            <div className="ph-text">
                <div className="kicker">{t("absences.kicker")}</div>
                <h1>{t("absences.title")}</h1>
                <p className="ab-lead">{lead}</p>
            </div>
            {children && <div className="ph-act">{children}</div>}
        </div>
    );
}

/** Zeitleiste and Pro Raid: the orga's overview of who is away when. */
function OrgaViews({ user, view, patch, viewSwitch, onAttendance }: {
    user: ShellContext["user"];
    view: View;
    patch: (p: Partial<View>) => void;
    viewSwitch: ReactNode;
    onAttendance: (userId: string) => void;
}) {
    const t = useT();
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

    if (overview.error && !data) return <div className="empty">{t("absences.loadError", { message: overview.error.message })}</div>;
    if (!data) return <RaidLoader text={t("absences.loading")} />;

    // The server names every category of the weeks, whatever is picked; a raid without one ("") is not a chip of its own.
    const categories = data.categories.filter((c) => c.id);
    const picked = pickedOf(view.category);

    const rows = visibleRaiders(data.raiders, { presence: view.presence, search });
    const canEnter = data.canEdit && !!own.data;
    const enter = (target: RaiderRef | null) => setDialog({ target });

    return (
        <div className="ab-page">
            <Head lead={t("absences.lead")}>
                {viewSwitch}
                {data.canEdit && (
                    <Button icon={<AbsenceIcon />} disabled={!canEnter} onClick={() => enter(null)}>{t("absences.enter")}</Button>
                )}
            </Head>

            {/* everybody's absences are the orga's (design canvas Oct 2026, B); "Meine Anwesenheit" stays outside */}
            <OrgaZone user={user} areas={["roster"]}>
            <AbsenceTiles data={data} />

            <div className="ab-filters">
                {categories.length > 1 && (
                    <CategoryChips categories={data.categories} picked={picked} onChange={(ids) => patch({ category: ids.join(",") })} />
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
            ) : <AbsenceRaids data={data} />}
            </OrgaZone>

            {drawer && (
                <RaiderDrawer
                    key={`${drawer}-${saved}`}
                    userId={drawer}
                    onClose={() => setDrawer("")}
                    onEnter={(r) => enter(refOf(r))}
                    onChanged={() => { void overview.reload(); }}
                    onAttendance={(id) => { setDrawer(""); onAttendance(id); }}
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

/** The stored pick ("a,b", "" = all) as a list. */
function pickedOf(category: string): string[] {
    return category.split(",").map((id) => id.trim()).filter(Boolean);
}

/**
 * Which raid categories the overview shows: "Alle", or any number of them,
 * each chip in its category's colour (the dots of the timeline). Picking every
 * one, or the last one off again, is "Alle".
 */
function CategoryChips({ categories, picked, onChange }: {
    categories: { id: string; name: string }[];
    picked: string[];
    onChange: (ids: string[]) => void;
}) {
    const t = useT();
    const offered = categories.filter((c) => c.id);
    // a pick of a category no longer offered (switched off, no raids in these weeks) drops out with the next click
    const valid = picked.filter((id) => offered.some((c) => c.id === id));
    const toggle = (id: string) => {
        const next = valid.includes(id) ? valid.filter((x) => x !== id) : [...valid, id];
        onChange(next.length === offered.length ? [] : next);
    };
    return (
        <div className="chip-row ab-catchips" role="group" aria-label={t("absences.filter.categoryAria")}>
            <Chip pressed={!picked.length} tone={!picked.length ? "accent" : undefined} onClick={() => onChange([])}>{t("common.all")}</Chip>
            {offered.map((c) => {
                const on = picked.includes(c.id);
                return (
                    <Chip key={c.id} pressed={on} tone={on ? "accent" : undefined} onClick={() => toggle(c.id)}
                        icon={<i className={`ab-catdot ab-cat-${categoryTone(c.id, categories)}`} aria-hidden="true" />}>
                        {c.name || c.id}
                    </Chip>
                );
            })}
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
