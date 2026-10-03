// Tab "Setup" of an own event (#263): the proposal, the orga's changes, the
// approval. Kept calm on purpose — group cards with one compact line per
// raider, the bench beside them and a narrow column with only what decides
// the evening (roles against the plan, buffs, fairness, wishes, "nicht
// zusammen" — asked once, counts only, never names). Why somebody
// stands where they do is the line's tooltip, the weights sit behind a dialog,
// and so does Claude's explanation.
//
// Moving: drag a raider onto a group, onto the bench, back into "Angemeldet"
// (the pool of who signed up and is neither placed nor benched, #517) or onto
// another raider (swap — inside one group that reorders it; every group always
// shows its five places). Without a mouse: activate a raider (click, Enter),
// then the target. Every move is saved at once and comes back valued by the
// server. Posting carries the bench only with "Bench mitposten" ticked.

import { useEffect, useRef, useState } from "react";
import { approveRaidSetup, getRaidSetup, proposeRaidSetup, publishRaidSetup, saveRaidSetup, saveSetupExtraRole, saveSetupPingText, saveSetupSignup, setSetupConfirmation, confirmAllSetup, updateRaidSize, type ApiError, type SetupConfirmation, type SetupEditorData, type SetupPerson, type SetupPlacementInput, type SetupSignupInput } from "../../../api";
import { useApi } from "../../../hooks/useApi";
import { applyLocal, moveRaider, peopleOf, resizeLineup, respecRaider, suggestGroup, toInput, toggleLock, withAllGroups, withSetupDefaults, GROUP_SIZE, type SetupTarget } from "../../../lib/setupEditor";
import { useT } from "../../../i18n";
import { Button } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import { useConfirm } from "../../../components/ui/Modal";
import RaidLoader from "../../../components/ui/RaidLoader";
import WowIcon from "../../../components/ui/WowIcon";
import { useJobs } from "../../../components/Jobs";
import { LockIcon } from "../../../components/icons";
import type { RaidCtx } from "../meta";
import "../../../styles/setup-editor.css";
import { readCompact, storeCompact } from "./setupText";
import { BenchCard, GroupCard, type Interaction, PoolCard, ReadOnly } from "./Board";
import { MoreMenu, PingTextField, PublishLine, SizeControl, StatusBadge } from "./Controls";
import { Summary } from "./Summary";
import { SlotTip, TipEmpty, type SlotActions } from "./SlotTip";
import { ExplainModal, WeightsModal } from "./SetupModals";
import { SearchModal } from "./SearchModal";
import { SignupEditModal } from "./SignupEditModal";

export default function SetupEditor({ ctx }: { ctx: RaidCtx }) {
    const t = useT();
    const jobs = useJobs();
    const ask = useConfirm();
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);
    // the raider the docked panel shows: the one the pointer touched last
    const [inspected, setInspected] = useState<string | null>(null);
    const [dialog, setDialog] = useState<"weights" | "explain" | "search" | null>(null);
    const [posting, setPosting] = useState(false);
    // "Anmeldung bearbeiten" (#521): the raider whose signup the dialog changes
    const [editing, setEditing] = useState<string | null>(null);
    // "Bench mitposten" (#517): null = what the event remembered from the last post (off by default)
    const [benchChoice, setBenchChoice] = useState<boolean | null>(null);
    const [compact, setCompact] = useState(readCompact);
    const toggleCompact = () => setCompact((on) => {
        storeCompact(!on);
        return !on;
    });
    const saving = useRef(0);

    const setupData = useApi(() => getRaidSetup(ctx.eventId).then((d) => (d.setup ? { ...d, setup: withSetupDefaults(d.setup) } : d)), [ctx.eventId]);
    const { data, setData } = setupData;
    const load = setupData.reload;

    // The raider the panel holds on to: the one clicked last. Unlike `selected`
    // (picked to be moved — the next raider clicked is swapped with it) it
    // outlives a panel action: confirm, fix or edit drop the pick, the panel
    // stays, and the next click on a raider just picks that one.
    const [pinned, setPinned] = useState<string | null>(null);

    useEffect(() => {
        if (!selected && !pinned) return undefined;
        const esc = (e: globalThis.KeyboardEvent) => {
            if (e.key !== "Escape") return;
            setSelected(null);
            setPinned(null);
        };
        document.addEventListener("keydown", esc);
        return () => document.removeEventListener("keydown", esc);
    }, [selected, pinned]);

    const setup = data?.setup || null;
    const postBench = benchChoice ?? !!data?.publish?.bench;

    // The DMs of an approval run on in the background: poll only their state, so
    // a move the orga makes meanwhile is never overwritten by an older lineup.
    const dmsRunning = data?.publish?.dms?.status === "running";
    useEffect(() => {
        if (!dmsRunning) return undefined;
        const timer = setInterval(() => {
            getRaidSetup(ctx.eventId)
                .then((next) => setData((prev) => (prev ? { ...prev, publish: next.publish } : prev)))
                .catch(() => undefined);
        }, 3000);
        return () => clearInterval(timer);
    }, [dmsRunning, ctx.eventId, setData]);

    // Moves come faster than answers. Every save waits for the one before it and
    // carries the version the server last confirmed, and the next move builds on
    // the lineup as drawn (current.data) — so quick moves never trip the
    // server's "changed in the meantime" check on their own.
    const current = useRef<SetupEditorData | null>(null);
    current.current = data;
    const confirmedVersion = useRef(0);
    const chain = useRef<Promise<unknown>>(Promise.resolve());
    useEffect(() => { if (data?.setup && !saving.current) confirmedVersion.current = data.setup.version; }, [data]);

    /** A server answer, with the Discord names the page already knows (mutations do not resolve them again). */
    const withNames = (raw: SetupEditorData): SetupEditorData => {
        if (!raw.setup) return raw;
        const next = { ...raw, setup: withSetupDefaults(raw.setup) };
        const known = current.current?.setup ? peopleOf(current.current.setup) : new Map<string, SetupPerson>();
        const named = (p: SetupPerson) => (p.name ? p : { ...p, name: known.get(p.userId)?.name || "" });
        return { ...next, setup: { ...next.setup, groups: next.setup.groups.map((g) => ({ ...g, slots: g.slots.map(named) })), bench: next.setup.bench.map(named), pool: (next.setup.pool || []).map(named) } };
    };

    /** Answer of a mutating call: take the server's lineup, tell the parent the step changed. */
    const accept = (next: SetupEditorData, message?: string) => {
        if (next.setup) confirmedVersion.current = next.setup.version;
        // attendance is only read on the page load — keep it across the answers of moves
        setData({ ...withNames(next), attendance: next.attendance || current.current?.attendance });
        ctx.onChanged(message || "");
    };

    // `patch`: other top-level fields to redraw at once alongside the lineup —
    // only the resize uses it, to show the new size/group count instantly
    // instead of waiting for the server's answer.
    const save = (input: SetupPlacementInput, extra: { fairness?: boolean; wishes?: boolean; avoid?: boolean } = {}, patch: Partial<SetupEditorData> = {}) => {
        const shown = current.current;
        if (!shown?.setup) return chain.current;
        const ticket = ++saving.current;
        setData({ ...shown, ...patch, setup: applyLocal(shown.setup, input) });
        chain.current = chain.current.then(async () => {
            try {
                const next = await saveRaidSetup(ctx.eventId, { ...input, ...extra, version: confirmedVersion.current });
                if (next.setup) confirmedVersion.current = next.setup.version;
                // only the last pending save redraws; earlier answers would flash an older lineup
                if (ticket === saving.current) {
                    saving.current = 0;
                    // a move answers quietly — a message only when the posted setup could not follow
                    accept(next, next.message);
                }
            } catch (e) {
                saving.current = 0;
                jobs.notify((e as ApiError).message || t("setup.editor.saveFailed"), "err");
                load();
            }
        });
        return chain.current;
    };

    /** Put a raider into the setup as another spec of their class (the third tank, an extra healer) — saved like any move. */
    const respec = (userId: string, specKey: string) => {
        const shown = current.current;
        if (!shown?.setup) return;
        const person = peopleOf(shown.setup).get(userId);
        const spec = person?.classSpecs?.find((x) => x.key === specKey);
        if (!spec) return;
        const result = respecRaider(toInput(shown.setup), userId, spec);
        if ("error" in result && result.error) return jobs.notify(result.error, "err");
        if (result.input) save(result.input);
    };

    const move = (target: SetupTarget, userId?: string) => {
        const who = userId || selected;
        setSelected(null);
        setDragging(null);
        const shown = current.current;
        if (!who || !shown?.setup) return;
        const result = moveRaider(toInput(shown.setup), who, target, peopleOf(shown.setup), shown.event.size || 0);
        if ("error" in result && result.error) return jobs.notify(result.error, "err");
        if (result.input) save(result.input);
    };

    const pick = (userId: string) => {
        if (!selected) {
            setPinned(userId);
            return setSelected(userId);
        }
        if (selected === userId) {
            setPinned(null);
            return setSelected(null);
        }
        move({ userId });
    };

    /** A panel action on the raider shown: done, the pick is dropped (no swap on the next click), the panel stays. */
    const act = (fn: () => void) => () => {
        setSelected(null);
        fn();
    };

    /**
     * Resize the raid (#354): reshuffled locally at once (resizeLineup), then
     * persisted — the size itself through the event's own PATCH (the create
     * dialog's endpoint, `updateRaidSize`), the resulting lineup through the
     * usual setup save, so both land together.
     */
    const resize = async (newSize: number) => {
        const shown = current.current;
        if (!shown?.setup || newSize === shown.event.size) return;
        const groupCount = Math.max(1, Math.ceil(newSize / GROUP_SIZE));
        const resized = resizeLineup(toInput(shown.setup), newSize);
        // reshuffled at once, in the browser — no server round trip needed to see it
        setData({ ...shown, event: { ...shown.event, size: newSize }, groupCount, setup: applyLocal(shown.setup, resized) });
        setBusy(true);
        try {
            await chain.current;
            // the size itself first, so the lineup save below already reads it back applied
            await updateRaidSize(ctx.eventId, newSize);
            await save(resized, {}, { event: { ...shown.event, size: newSize }, groupCount });
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.sizeFailed"), "err");
            load();
        } finally {
            setBusy(false);
        }
    };

    /**
     * "Nicht zusammen": asked once per event, the first time a proposal is made
     * while such pairs stand among the signups. Afterwards the side column's
     * switch changes it; the server remembers the answer.
     */
    const avoidAnswer = async (): Promise<boolean | undefined> => {
        const shown = current.current;
        if (!shown?.avoidPairs || typeof shown.setup?.options?.avoid === "boolean") return undefined;
        return ask({
            title: t("setup.avoid.askTitle"),
            text: t("setup.avoid.askText", { count: shown.avoidPairs }),
            action: t("setup.avoid.askYes"),
            cancelLabel: t("setup.avoid.askNo"),
            icon: "achievement_guildperk_everybodysfriend",
        });
    };

    const propose = async (weights?: Record<string, number>) => {
        setDialog(null);
        const avoid = await avoidAnswer();
        setBusy(true);
        await chain.current;
        const next = await jobs.run({ label: t("setup.editor.proposalJob"), detail: data?.event.title || "", icon: "inv_misc_map_01", quiet: true }, () => (
            proposeRaidSetup(ctx.eventId, { ...(weights ? { weights } : {}), ...(avoid === undefined ? {} : { avoid }) })
        ));
        setBusy(false);
        if (next) accept(next, next.message);
    };

    const approve = async () => {
        if (!setup) return;
        if (!setup.checks.ok) {
            const okay = await ask({
                title: t("setup.editor.approveAnywayTitle"),
                text: t("setup.editor.approveAnywayText"),
                action: t("setup.editor.approve"),
                icon: "inv_misc_map_01",
            });
            if (!okay) return;
        }
        setBusy(true);
        try {
            // approve what is drawn: wait for the moves still on their way first
            await chain.current;
            const next = await approveRaidSetup(ctx.eventId, confirmedVersion.current, { bench: postBench });
            accept(next, next.message);
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.approveFailed"), "err");
            load();
        } finally {
            setBusy(false);
        }
    };

    const post = async () => {
        setPosting(true);
        try {
            await chain.current;
            const next = await publishRaidSetup(ctx.eventId, { bench: postBench });
            accept(next, next.message);
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.postFailed"), "err");
            load();
        } finally {
            setPosting(false);
        }
    };

    // The orga's marks, many in a row: each is drawn at once and sent one after
    // the other (the server answers at once, the Discord message follows a
    // moment after the last). A mark still on its way overrides whatever an
    // answer to an earlier one says — so a quick second click never jumps back.
    const pendingMarks = useRef(new Map<string, SetupConfirmation | "">());
    const markChain = useRef<Promise<unknown>>(Promise.resolve());
    const withPending = (marks: Record<string, SetupConfirmation>) => {
        const out = { ...marks };
        for (const [id, status] of pendingMarks.current) {
            if (status) out[id] = status;
            else delete out[id];
        }
        return out;
    };
    const settle = (userId: string, sent: SetupConfirmation | "") => {
        if (pendingMarks.current.get(userId) === sent) pendingMarks.current.delete(userId);
    };

    /** The check in the raider panel: confirmed ↔ none (a "Cancel" turns into confirmed). */
    const toggleConfirm = (userId: string) => {
        const was = (current.current?.confirmations || {})[userId];
        const next: SetupConfirmation | "" = was === "confirmed" ? "" : "confirmed";
        pendingMarks.current.set(userId, next);
        setData((prev) => (prev ? { ...prev, confirmations: withPending(prev.confirmations || {}) } : prev));
        markChain.current = markChain.current.then(async () => {
            try {
                const answer = await setSetupConfirmation(ctx.eventId, userId, next);
                settle(userId, next);
                setData((prev) => (prev ? { ...prev, confirmations: withPending(answer.confirmations || {}) } : prev));
            } catch (e) {
                settle(userId, next);
                // back to what the line showed before this click — unless a newer click is already on its way
                setData((prev) => {
                    if (!prev || pendingMarks.current.has(userId)) return prev;
                    const marks = { ...(prev.confirmations || {}) };
                    if (was) marks[userId] = was;
                    else delete marks[userId];
                    return { ...prev, confirmations: marks };
                });
                jobs.notify((e as ApiError).message || t("setup.editor.confirmFailed"), "err");
            }
        });
    };

    /** "Alle bestätigen": after the marks still on their way, the check for everybody in a group without an answer. */
    const confirmEveryone = async () => {
        await markChain.current;
        try {
            const answer = await confirmAllSetup(ctx.eventId);
            setData((prev) => (prev ? { ...prev, confirmations: withPending(answer.confirmations || {}) } : prev));
            jobs.notify(answer.count ? t("setup.editor.confirmAllDone", { count: answer.count }) : t("setup.editor.confirmAllNone"));
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.confirmFailed"), "err");
        }
    };

    const toggleExtra = async (userId: string, role: "tank" | "healer", on: boolean) => {
        try {
            const next = await saveSetupExtraRole(ctx.eventId, userId, role, on);
            setData((prev) => (prev ? { ...prev, extraRoles: next.extraRoles } : prev));
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.saveFailed"), "err");
        }
    };

    /**
     * The orga changes a raider's signup (#521). Waits for the moves still on
     * their way, then the server saves the signup and the setup follows (place
     * kept, a signed-off raider out) — its answer is drawn like any other.
     * A failure stays in the dialog (it throws back).
     */
    const saveSignup = async (input: SetupSignupInput) => {
        await chain.current;
        const next = await saveSetupSignup(ctx.eventId, input);
        accept(next, next.message);
        setEditing(null);
    };

    const savePingText = async (text: string) => {
        try {
            const next = await saveSetupPingText(ctx.eventId, text);
            setData((prev) => (prev ? { ...prev, pingText: next.pingText } : prev));
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.saveFailed"), "err");
        }
    };

    if (setupData.error) return <div className="empty">{t("setup.editor.loadFailed", { message: setupData.error.message })}</div>;
    if (!data) return <RaidLoader text={t("setup.editor.loading")} compact />;
    if (!data.canWrite) return <ReadOnly data={data} />;

    if (!setup) {
        return (
            <div className="se-start">
                <WowIcon name="inv_misc_map_01" size={40} />
                <div>
                    <div className="se-start-title">{t("setup.editor.noSetup")}</div>
                    <div className="se-start-sub">
                        {[
                            t("setup.editor.signedUp", { count: data.signupCount || 0 }),
                            data.absent ? t("setup.editor.absent", { count: data.absent }) : "",
                            t("setup.editor.places", { count: data.event.size }),
                        ].filter(Boolean).join(" · ")}
                    </div>
                </div>
                <Button icon="spell_holy_borrowedtime" running={busy} disabled={!data.signupCount} onClick={() => propose()}>{t("setup.editor.createProposal")}</Button>
            </div>
        );
    }

    // the glow: where the raider being dragged (or picked) helps a group most
    const moving = dragging || selected;
    const movingPerson = moving ? peopleOf(setup).get(moving) : undefined;
    const suggest = movingPerson ? suggestGroup(movingPerson, withAllGroups(setup.groups, data.groupCount || 1)) : null;
    // The panel shows the raider clicked last (`pinned`) — the pointer passing over
    // other lines on its way to the panel's buttons changes nothing — else the
    // one the pointer touched last. Looked up fresh every render, so a move
    // redraws the panel's group and buffs.
    const shownId = (pinned && peopleOf(setup).has(pinned) ? pinned : null) || inspected;
    const inspectedPerson = shownId ? peopleOf(setup).get(shownId) : undefined;
    const editPerson = editing ? peopleOf(setup).get(editing) : undefined;
    // on the bench or in the pool: no slot yet, so no "im Setup als" and no extra role
    const inspectedIsBench = !!inspectedPerson && [...setup.bench, ...(setup.pool || [])].some((b) => b.userId === inspectedPerson.userId);
    const inspectedInPool = !!inspectedPerson && (setup.pool || []).some((b) => b.userId === inspectedPerson.userId);
    const inspectedInGroup = !!inspectedPerson && setup.groups.some((g) => g.slots.some((s) => s.userId === inspectedPerson.userId));
    const confirmations = data.confirmations || {};
    const ui: Interaction = { editable: !busy, selected, dragging, attendance: data.attendance || {}, extraRoles: data.extraRoles || {}, suggest, onInspect: setInspected, onPick: pick, onDrop: move, onDrag: setDragging, onEdit: setEditing, confirmations, pinned: shownId === pinned ? pinned : null };
    // posting is approving (no separate step): once the message is out, every change goes live by itself
    const live = setup.status === "approved" && !!data.publish?.posted;
    // the actions on the raider shown (SlotTip) — the check only for a group place of a posted (= approved) setup
    const actions: SlotActions = inspectedPerson && !busy ? {
        confirmation: inspectedInGroup ? confirmations[inspectedPerson.userId] : undefined,
        onConfirm: inspectedInGroup && setup.status === "approved" ? act(() => toggleConfirm(inspectedPerson.userId)) : undefined,
        locked: !!inspectedPerson.locked,
        onLock: inspectedInPool ? undefined : act(() => void save(toggleLock(toInput(current.current?.setup || setup), inspectedPerson.userId))),
        onEdit: act(() => setEditing(inspectedPerson.userId)),
    } : {};
    // who in the groups has no answer yet — "Alle bestätigen" is there only while somebody is left
    const unanswered = setup.groups.reduce((n, g) => n + g.slots.filter((s) => !confirmations[s.userId]).length, 0);
    const groups = withAllGroups(setup.groups, data.groupCount || 1);
    const partyBuffs = setup.checks.buffs.party;
    const lockedCount = [...setup.groups.flatMap((g) => g.slots), ...setup.bench].filter((p) => p.locked).length;
    const size = setup.checks.size;

    return (
        <div className={`se-editor${compact ? " se-compact" : ""}`}>
            <div className="se-bar">
                <StatusBadge setup={setup} />
                <SizeControl size={data.event.size} disabled={busy} onCommit={resize} />
                <Badge
                    tone={size.ok ? undefined : "mid"} tip={t("setup.editor.placesTip")}
                    tipSub={t("setup.editor.placesSub", { count: size.count, size: size.size, bench: setup.bench.length })}
                >
                    {t("setup.editor.placesBadge", { count: size.count, size: size.size })}
                </Badge>
                {lockedCount > 0 && (
                    <Badge tone="accent" icon={<LockIcon />} tip={t("setup.editor.lockedTip")} tipSub={t("setup.editor.lockedSub")}>
                        {t("setup.editor.locked", { count: lockedCount })}
                    </Badge>
                )}
                <span className="se-bar-hint">
                    {selected ? t("setup.editor.pickTarget") : t("setup.editor.dragHint")}
                </span>
                <div className="se-bar-act">
                    {/* the rarely needed ones behind "Mehr"; in the bar only what the evening is about */}
                    <MoreMenu
                        items={[
                            { id: "compact", label: t("setup.editor.compact"), sub: t("setup.editor.compactSub"), icon: "inv_misc_book_09", on: compact, onSelect: toggleCompact },
                            { id: "search", label: t("setup.editor.search"), sub: t("setup.editor.searchSub"), icon: "inv_misc_spyglass_02", disabled: !data.search, onSelect: () => setDialog("search") },
                            { id: "explain", label: t("setup.editor.explain"), sub: t("setup.editor.explainSub"), icon: "inv_scroll_03", onSelect: () => setDialog("explain") },
                            { id: "weights", label: t("setup.summary.weights"), sub: t("setup.editor.weightsSub"), icon: "inv_misc_gear_01", disabled: busy, onSelect: () => setDialog("weights") },
                        ]}
                    />
                    <Button variant="ghost" size="sm" icon="spell_holy_borrowedtime" disabled={busy} onClick={() => propose()}>{t("setup.editor.repropose")}</Button>
                    {setup.status === "approved" && unanswered > 0 && (
                        <Button
                            variant="ghost" size="sm" icon="achievement_guildperk_everybodysfriend" disabled={busy}
                            data-tip={t("setup.editor.confirmAll")} data-tip-sub={t("setup.editor.confirmAllSub")}
                            onClick={() => void confirmEveryone()}
                        >
                            {t("setup.editor.confirmAll")} <small className="se-bar-count">{unanswered}</small>
                        </Button>
                    )}
                    {/* a draft: "Setup posten" approves and posts in one; posted: a quiet "Gepostet" (approved but not
                        out yet, e.g. the bot was offline — the line under the bar has "Setup posten" for that) */}
                    {setup.status !== "approved" && (
                        <Button size="sm" icon="inv_letter_15" disabled={busy} data-tip={t("setup.editor.approve")} data-tip-sub={t("setup.editor.approveSub")} onClick={approve}>
                            {t("setup.editor.approve")}
                        </Button>
                    )}
                    {live && (
                        <Button size="sm" icon="inv_letter_15" disabled data-tip={t("setup.editor.approved")} data-tip-sub={t("setup.editor.approvedSub")}>
                            {t("setup.editor.approved")}
                        </Button>
                    )}
                </div>
            </div>
            <PublishLine data={data} setup={setup} busy={busy} posting={posting} onPost={post} bench={postBench} onBench={setBenchChoice} />
            {/* the top area: left the ping message over the evening's numbers, right the raider panel (the one the pointer touched last) — one fixed height */}
            <div className="se-topline">
                <div className="se-topleft">
                    <PingTextField value={data.pingText || ""} disabled={busy} onSave={savePingText} />
                    <Summary
                        data={data} setup={setup} busy={busy}
                        onFairness={(on) => save(toInput(current.current?.setup || setup), { fairness: on })}
                        onWishes={(on) => save(toInput(current.current?.setup || setup), { wishes: on })}
                        onAvoid={(on) => save(toInput(current.current?.setup || setup), { avoid: on })}
                    />
                </div>
                {inspectedPerson ? <SlotTip p={inspectedPerson} attendance={data.attendance ? data.attendance[inspectedPerson.userId] : undefined} extra={(data.extraRoles || {})[inspectedPerson.userId] || []} onExtra={inspectedIsBench ? undefined : (role, on) => void toggleExtra(inspectedPerson.userId, role, on)} onSpec={busy || inspectedIsBench ? undefined : (key) => respec(inspectedPerson.userId, key)} actions={actions} pinned={shownId === pinned} /> : <TipEmpty />}
            </div>

            <div className="se-layout">
                {/* the setup on top, the bench under a divider, then who signed up and is not in it (#517) */}
                <div className="se-main">
                    <div className="se-groups">
                        {groups.map((g) => (
                            <GroupCard key={g.index} group={g} ui={ui} buffs={partyBuffs.filter((b) => b.groups.includes(g.index))} />
                        ))}
                    </div>
                    <BenchCard bench={setup.bench} ui={ui} />
                    <PoolCard pool={setup.pool || []} ui={ui} />
                </div>
            </div>

            <WeightsModal open={dialog === "weights"} onClose={() => setDialog(null)} data={data} setup={setup} onApply={(w) => propose(w)} />
            <SearchModal open={dialog === "search"} onClose={() => setDialog(null)} ctx={ctx} search={data.search} />
            {editPerson && <SignupEditModal key={editPerson.userId} eventId={ctx.eventId} person={editPerson} onClose={() => setEditing(null)} onSave={saveSignup} />}
            <ExplainModal open={dialog === "explain"} onClose={() => setDialog(null)} ctx={ctx} data={data} setup={setup} onDone={load} />
        </div>
    );
}
