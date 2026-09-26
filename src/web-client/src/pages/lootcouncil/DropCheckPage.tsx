// "Das ist gerade gedroppt — wer bekommt es?"
//
// The one question a council asks under time pressure, so it is a page of its
// own (/lootcouncil/drop/:itemId) instead of a tab: a link can be shared, and
// seven or more candidates have room. Pick the item, see everyone it fits
// ranked by what it would actually gain them, and simulate exactly that item —
// seconds, not the minutes the whole BiS list takes. No estimates: until the
// simulation is through a candidate says "nicht simuliert".
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    getLootCouncil, loadCouncilLogGear, refreshCouncilArmory, searchCouncilItems,
    type ApiError, type CouncilCandidate, type CouncilFocus, type ItemSearchResult } from "../../api";
import { useJobs, useToast } from "../../components/Jobs";
import ItemSearchPicker from "../../components/loot/ItemSearchPicker";
import PageLoader from "../../components/PageLoader";
import { Badge, Button, PartHead } from "../../components/ui";
import { ChevronLeftIcon } from "../../components/icons";
import { usePersistedState } from "../../lib/persistedState";
import { useTableSort } from "../../lib/tableSort";
import { refreshWowheadLinks } from "../../lib/wowheadTooltips";
import { itemQualityProps } from "../../lib/itemQuality";
import {
    CANDIDATE_SORT, FILTER_DEFAULT, VIEW_KEY, WOWHEAD, dropHref, pickVerdict, raiderHref, useCouncilSim, waitedTip,
    type CandidateSortKey, type FilterView } from "./council";
import { BisSpecs, ContentBadge, FoldRow, LootCount, RaiderIdent } from "./ItemBits";
import { CandidateTable, ListBadge } from "./CandidateTable";
import { NeedBar } from "./NeedBar";
import { SlotOptions } from "./GearBadges";
import "../../styles/loot-council.css";

export default function DropCheckPage() {
    const { itemId: param } = useParams();
    const itemId = Number(param) || 0;
    const navigate = useNavigate();
    const jobs = useJobs();
    const toast = useToast();
    // The same filters the council page is set to — read, never written here.
    const [view] = usePersistedState<FilterView>(VIEW_KEY, FILTER_DEFAULT);
    const [focus, setFocus] = useState<CouncilFocus | null>(null);
    const [simAvailable, setSimAvailable] = useState(false);
    const [error, setError] = useState<ApiError | null>(null);
    const [loading, setLoading] = useState(false);
    const [unwearableOpen, setUnwearableOpen] = useState(false);
    // The character a "Log laden"/"Gear aus Armory holen" reload is running
    // for, from a candidate's fold-out gear panel — one at a time.
    const [gearBusyChar, setGearBusyChar] = useState<string | null>(null);
    const { sim, simRunning, runSim } = useCouncilSim();
    const candidateSort = useTableSort<CandidateSortKey>("lootcouncil.candidate-sort", CANDIDATE_SORT, "gain");

    /** This item against the raiders it fits. */
    const simulateDrop = (f: CouncilFocus) => {
        const subjects = f.candidates
            .filter((c) => c.simSupported && c.hasGear)
            .map((c) => ({ key: c.key, specKey: c.specKey }));
        runSim([f.item.id], subjects, `Drop prüfen: ${f.item.name || `Item ${f.item.id}`}`);
    };
    /** Just one candidate — the ↻ button next to "nicht simuliert"/"Fehler". */
    const simulateOne = (f: CouncilFocus, candidate: CouncilCandidate) => {
        runSim([f.item.id], [{ key: candidate.key, specKey: candidate.specKey }], `${candidate.character}: ${f.item.name || `Item ${f.item.id}`}`);
    };
    // What happens after a drop loaded (the simulation), as a ref: the effect
    // must not hang on the identity of runSim, or it would rerun every render.
    const autoSimRef = useRef<(f: CouncilFocus) => void>(() => {});
    autoSimRef.current = simulateDrop;

    const fetchFocus = () => getLootCouncil({
        role: view.role, tiers: view.tiers, contents: view.contents, category: view.category, bisTier: view.bisTier,
        item: itemId,
    });

    useEffect(() => {
        if (!itemId) { setFocus(null); return undefined; }
        let alive = true;
        setLoading(true);
        jobs.run({ label: "Drop wird geprüft", quiet: true }, fetchFocus)
            .then((d) => {
                if (!alive) return;
                if (!d) { setError({ code: "load", message: "Der Drop konnte nicht geladen werden." } as ApiError); return; }
                setError(null);
                setFocus(d.focus);
                setSimAvailable(d.sim.available);
                // Ohne Simulation gibt es keinen Zugewinn und keine Empfehlung —
                // also wird der Drop sofort gerechnet, nicht erst auf Klick.
                if (d.focus && d.sim.available) autoSimRef.current(d.focus);
            })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemId, view.role, view.tiers, view.contents, view.category, view.bisTier, jobs]);

    /** Re-reads the focus after a gear reload — quiet, no page-level spinner. */
    const reloadFocus = async (): Promise<CouncilFocus | null> => {
        const d = await jobs.run({ label: "Wird aktualisiert", quiet: true }, fetchFocus);
        if (!d) return null;
        setFocus(d.focus);
        setSimAvailable(d.sim.available);
        return d.focus;
    };

    /**
     * Fetch one raider's current gear from the armory, then reload — and say
     * what the reload shows: the armory regularly answers with an arena set,
     * which the server refuses, and the button would otherwise look inert.
     */
    const loadArmory = async (character: string) => {
        if (gearBusyChar) return;
        setGearBusyChar(character);
        const result = await jobs.run(
            { label: "Armory wird geladen", detail: character, quiet: true },
            () => refreshCouncilArmory([character]),
        );
        if (result) {
            const fresh = await reloadFocus();
            const row = fresh?.candidates.find((c) => c.character.toLowerCase() === character.toLowerCase());
            if (!result.answered) {
                toast(`Die Armory kennt ${character} nicht (oder antwortet gerade nicht) — es bleibt beim Stand der letzten Auswertung.`, "err");
            } else if (row?.gear?.armoryRejected === "pvp") {
                toast(`${character}: die Armory zeigt PvP-Gear — es bleibt beim Set aus dem letzten Raid.`, "err");
            } else if (row?.gear?.armoryRejected === "role") {
                toast(`${character}: die Armory zeigt ein Set der anderen Rolle — es bleibt beim Set aus dem letzten Raid.`, "err");
            } else if (row?.gear?.source === "armory") {
                toast(`Armory geladen: ${character} hat jetzt aktuelles Gear.`);
            }
        }
        setGearBusyChar(null);
    };

    /** The newest of the bot's logs that has this raider — same as the raider dialog's default "Laden". */
    const loadLog = async (character: string) => {
        if (gearBusyChar) return;
        setGearBusyChar(character);
        const result = await jobs.run(
            { label: "Log wird geladen", detail: character, quiet: true },
            () => loadCouncilLogGear({ character }),
        );
        if (result) {
            const fresh = await reloadFocus();
            const row = fresh?.candidates.find((c) => c.character.toLowerCase() === character.toLowerCase());
            const from = `„${result.reportTitle || result.reportId}“`;
            if (row?.gear?.logRejected === "pvp") {
                toast(`${character} trägt in ${from} PvP-Gear — es bleibt beim Set aus der Auswertung.`, "err");
            } else if (row?.gear?.logRejected === "role") {
                toast(`${character} trägt in ${from} ein Set der anderen Rolle — es bleibt beim Set aus der Auswertung.`, "err");
            } else {
                toast(`Gear von ${character} aus ${from} geladen: ${result.items ?? 0} Teile.`);
            }
        }
        setGearBusyChar(null);
    };

    useEffect(() => { refreshWowheadLinks(); }, [focus, sim]);

    const verdict = focus ? pickVerdict(focus.candidates, sim, focus.item.id) : null;
    const best = verdict ? verdict.best : null;
    const canSim = !!focus && simAvailable && focus.candidates.some((c) => c.simSupported && c.hasGear);

    return (
        <>
            <div className="page-head lc-drophead">
                <Button variant="ghost" size="sm" icon={<ChevronLeftIcon />} onClick={() => navigate("/lootcouncil")}>Raider</Button>
                <div className="ph-text">
                    <div className="kicker">Loot-Council › Drop prüfen</div>
                    <h1>Wer bekommt den Drop?</h1>
                </div>
                <div className="ph-act lc-dropsearch">
                    <ItemSearchPicker
                        search={searchCouncilItems}
                        onPick={(item: ItemSearchResult) => navigate(dropHref(item.id))}
                        placeholder={itemId ? "Anderes Item suchen …" : "Item-Namen tippen, z. B. Zhar'doom …"}
                    />
                </div>
            </div>

            {!itemId ? (
                <div className="lc-panel empty">
                    Noch kein Item gewählt — oben rechts suchen. Gesucht wird in der Item-Tabelle des Bots; wer das Teil
                    nicht anlegen kann, steht nicht unter den Kandidaten.
                </div>
            ) : loading && !focus ? (
                <PageLoader show text="Drop wird geprüft" />
            ) : error ? (
                <div className="empty">{error.message}</div>
            ) : !focus ? (
                <div className="lc-panel empty">Dieses Item kennt die Item-Tabelle des Bots nicht.</div>
            ) : (
                <>
                    <div className="lc-panel lc-dropitem2">
                        {focus.item.iconUrl
                            ? <img src={focus.item.iconUrl} alt="" {...itemQualityProps(focus.item.quality, "lc-dropitem2-icon")} />
                            : <span className="lc-dropitem2-icon lc-worn-blank" />}
                        <div className="lc-dropitem2-text">
                            <a href={WOWHEAD(focus.item.id)} target="_blank" rel="noreferrer" {...itemQualityProps(focus.item.quality, "lc-dropitem2-name")}>
                                {focus.item.name || `Item ${focus.item.id}`}
                            </a>
                            <div className="lc-dropitem2-meta">
                                <ContentBadge contentId={focus.item.contentId} label={focus.item.boss} />
                                <span>{[focus.item.boss, focus.item.ilvl ? `ilvl ${focus.item.ilvl}` : ""].filter(Boolean).join(" · ")}</span>
                            </div>
                        </div>
                        <div className="lc-dropitem2-bis">
                            <span className="lc-th">BiS für</span>
                            {focus.item.bisSpecs.length
                                ? <BisSpecs specs={focus.item.bisSpecs} />
                                : <Badge tip="Auf keiner BiS-Liste" tipSub="Steht auf keiner BiS-Liste der gewählten Tier-Stufe — kann trotzdem ein Upgrade sein.">keine Liste</Badge>}
                        </div>
                    </div>

                    <div className="lc-panel lc-verdictpanel">
                        <PartHead
                            icon="inv_misc_coin_02"
                            crumb="Drop prüfen › Empfehlung"
                            title={verdict?.basis === "sim" ? "Größter simulierter Zugewinn"
                                : verdict?.basis === "need" ? "Höchster Bedarf"
                                    : verdict?.basis === "pending" ? "Noch nicht simuliert" : "Kein Kandidat"}
                            tip={verdict?.basis === "need" ? "Keine Simulation für diese Specs" : undefined}
                            tipSub={verdict?.basis === "need" ? "WoWSims-TBC rechnet keine Heilung. Der Vorschlag folgt dem Bedarf — was das Teil bringt, sagt die Seite nicht, weil sie es nicht messen kann." : undefined}
                            action={canSim ? (
                                <Button variant="run" size="sm" icon="inv_gizmo_02" running={simRunning} onClick={() => simulateDrop(focus)}>
                                    {verdict?.basis === "sim" ? "Erneut simulieren" : "DPS-Gewinn simulieren"}
                                </Button>
                            ) : undefined}
                        />
                        {best && verdict ? (
                            <div className="lc-verdictrow">
                                <RaiderIdent
                                    name={best.character}
                                    classColor={best.classColor}
                                    specIconUrl={best.specIconUrl}
                                    sub={best.specLabel}
                                    size={44}
                                    big
                                    to={raiderHref(best.character)}
                                />
                                {verdict.basis === "sim" ? (
                                    <Badge tone="ok" className="lc-bigbadge" tip="Simulierte DPS-Differenz" tipSub="WoWSims, gleicher Seed für alle Kandidaten.">
                                        {verdict.delta > 0 ? "+" : ""}{Math.round(verdict.delta)} DPS
                                    </Badge>
                                ) : (
                                    <Badge tone="accent" className="lc-bigbadge" tip="Höchster Bedarf" tipSub="Geschätzt wird kein Zugewinn.">höchster Bedarf</Badge>
                                )}
                                <ListBadge candidate={best} />
                                <span className="lc-vsep" />
                                <span className="lc-vstat2"><span className="lc-th">Bedarf</span><NeedBar subject={best} width={140} /></span>
                                <span className="lc-vstat2"><span className="lc-th">Zuletzt</span><span className="lc-num" data-tip={waitedTip(best.daysSinceLoot)}>{best.daysSinceLoot === null ? "nie" : `${best.daysSinceLoot} Tage`}</span></span>
                                <span className="lc-vstat2"><span className="lc-th">Items</span><LootCount items={best.recentItems} total={best.lootCount} other={best.otherCount} /></span>
                                <span className="lc-vstat2 lc-vstat2-end"><span className="lc-th">Ersetzt</span><SlotOptions candidate={best} /></span>
                            </div>
                        ) : (
                            <div className="lc-verdictrow lc-muted">
                                {verdict?.basis === "pending"
                                    ? simRunning
                                        ? "Simulation läuft — der Fortschritt steht unten in der Mitte. Die Empfehlung erscheint, sobald sie durch ist."
                                        : "Noch nicht simuliert. Ohne Simulation gibt es keine Empfehlung — geschätzt wird nichts."
                                    : simAvailable
                                        ? "Für keinen Raider im aktuellen Filter ein passender Slot — Rolle oder Filter auf der Raider-Seite prüfen."
                                        : "Keine Simulation verfügbar. Ohne sie gibt es keinen Zugewinn und keine Empfehlung — geschätzt wird nichts."}
                            </div>
                        )}
                    </div>

                    {focus.candidates.length ? (
                        <>
                            <PartHead
                                icon="inv_misc_grouplooking"
                                crumb="Drop prüfen › Kandidaten"
                                title="Alle, die ihn tragen können"
                                tip="Zugewinn und Bedarf getrennt"
                                tipSub="Was das Item bringt (nur simuliert), und was dem Raider zusteht — die Abwägung trifft der Council."
                                action={<Badge count>{focus.candidates.length}</Badge>}
                            />
                            <div className="lc-panel lc-tablepanel">
                                <CandidateTable
                                    itemId={focus.item.id}
                                    candidates={focus.candidates}
                                    sim={sim}
                                    sortState={candidateSort}
                                    expandable
                                    retrying={simRunning}
                                    gearBusyChar={gearBusyChar}
                                    onRetry={(candidate) => simulateOne(focus, candidate)}
                                    onLoadLog={loadLog}
                                    onLoadArmory={loadArmory}
                                />
                            </div>
                        </>
                    ) : null}

                    {/* Wer es nicht anlegen kann, wird genannt statt still
                        weggelassen — sonst sieht eine kurze Liste nach einem Fehler aus. */}
                    {focus.unwearable.length ? (
                        <FoldRow
                            icon="ability_creature_cursed_02"
                            title="Können es nicht tragen"
                            count={focus.unwearable.length}
                            names={focus.unwearable.map((u) => u.character).join(", ")}
                            open={unwearableOpen}
                            onToggle={() => setUnwearableOpen((o) => !o)}
                        >
                            <div className="lc-dlist">
                                {focus.unwearable.map((u) => (
                                    <div key={u.key} className="lc-dlist-row">
                                        <RaiderIdent name={u.character} classColor={u.classColor} specIconUrl={u.specIconUrl} sub={u.specLabel} size={30} />
                                        <span className="lc-muted">{u.note}</span>
                                    </div>
                                ))}
                            </div>
                        </FoldRow>
                    ) : null}
                </>
            )}
        </>
    );
}
