// Tab "Setup" of an own event (#263): the proposal, the orga's changes, the
// approval. Kept calm on purpose — group cards with one compact line per
// raider, the bench beside them and a narrow column with only what decides
// the evening (roles against the plan, buffs, fairness, wishes, "nicht
// zusammen" — asked once, counts only, never names). Why somebody
// stands where they do is the line's tooltip, the weights sit behind a dialog,
// and so does Claude's explanation.
//
// Moving: drag a raider onto a group, onto the bench or onto another raider
// (swap — inside one group that reorders it; every group always shows its five
// places). Without a mouse: activate a raider (click, Enter), then the target.
// Every move is saved at once and comes back valued by the server.
import { useEffect, useRef, useState } from "react";
import { approveRaidSetup, getRaidSetup, proposeRaidSetup, publishRaidSetup, saveRaidSetup, saveSetupExtraRole, saveSetupPingText, updateRaidSize, type ApiError, type SetupEditorData, type SetupPerson, type SetupPlacementInput } from "../../../api";
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
import { BenchCard, GroupCard, type Interaction, ReadOnly } from "./Board";
import { PingTextField, PublishLine, SizeControl, StatusBadge } from "./Controls";
import { Summary } from "./Summary";
import { SlotTip, TipEmpty } from "./SlotTip";
import { ExplainModal, WeightsModal } from "./SetupModals";
import { SearchModal } from "./SearchModal";

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
    const [compact, setCompact] = useState(readCompact);
    const toggleCompact = () => setCompact((on) => {
        storeCompact(!on);
        return !on;
    });
    const saving = useRef(0);

    const setupData = useApi(() => getRaidSetup(ctx.eventId).then((d) => (d.setup ? { ...d, setup: withSetupDefaults(d.setup) } : d)), [ctx.eventId]);
    const { data, setData } = setupData;
    const load = setupData.reload;

    useEffect(() => {
        if (!selected) return undefined;
        const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
        document.addEventListener("keydown", esc);
        return () => document.removeEventListener("keydown", esc);
    }, [selected]);

    const setup = data?.setup || null;

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
        return { ...next, setup: { ...next.setup, groups: next.setup.groups.map((g) => ({ ...g, slots: g.slots.map(named) })), bench: next.setup.bench.map(named) } };
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
                    accept(next);
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
        if (!selected) return setSelected(userId);
        if (selected === userId) return setSelected(null);
        move({ userId });
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
            const next = await approveRaidSetup(ctx.eventId, confirmedVersion.current);
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
            const next = await publishRaidSetup(ctx.eventId);
            accept(next, next.message);
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.postFailed"), "err");
            load();
        } finally {
            setPosting(false);
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
    // looked up fresh every render, so a move redraws the panel's group and buffs
    const inspectedPerson = inspected ? peopleOf(setup).get(inspected) : undefined;
    const inspectedIsBench = !!inspectedPerson && setup.bench.some((b) => b.userId === inspectedPerson.userId);
    const ui: Interaction = { editable: !busy, selected, dragging, attendance: data.attendance || {}, extraRoles: data.extraRoles || {}, suggest, onInspect: setInspected, onPick: pick, onDrop: move, onDrag: setDragging, onLock: (userId) => save(toggleLock(toInput(current.current?.setup || setup), userId)) };
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
                    <Button
                        variant="ghost" size="sm" icon="inv_misc_book_09" aria-pressed={compact}
                        data-tip={t("setup.editor.compact")} data-tip-sub={t("setup.editor.compactSub")}
                        onClick={toggleCompact}
                    >
                        {t("setup.editor.compact")}
                    </Button>
                    <Button
                        variant="ghost" size="sm" icon="inv_misc_spyglass_02" disabled={!data.search}
                        data-tip={t("setup.editor.search")} data-tip-sub={t("setup.editor.searchSub")}
                        onClick={() => setDialog("search")}
                    >
                        {t("setup.editor.search")}
                    </Button>
                    <Button variant="ghost" size="sm" icon="inv_scroll_03" onClick={() => setDialog("explain")}>{t("setup.editor.explain")}</Button>
                    <Button variant="ghost" size="sm" icon="inv_misc_gear_01" disabled={busy} onClick={() => setDialog("weights")}>{t("setup.summary.weights")}</Button>
                    <Button variant="ghost" size="sm" icon="spell_holy_borrowedtime" disabled={busy} onClick={() => propose()}>{t("setup.editor.repropose")}</Button>
                    <Button size="sm" icon="achievement_guildperk_everybodysfriend" disabled={busy || setup.status === "approved"} onClick={approve}>
                        {setup.status === "approved" ? t("setup.editor.approved") : t("setup.editor.approve")}
                    </Button>
                </div>
            </div>
            <PublishLine data={data} setup={setup} busy={busy} posting={posting} onPost={post} />
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
                {inspectedPerson ? <SlotTip p={inspectedPerson} attendance={data.attendance ? data.attendance[inspectedPerson.userId] : undefined} extra={(data.extraRoles || {})[inspectedPerson.userId] || []} onExtra={inspectedIsBench ? undefined : (role, on) => void toggleExtra(inspectedPerson.userId, role, on)} onSpec={busy || inspectedIsBench ? undefined : (key) => respec(inspectedPerson.userId, key)} /> : <TipEmpty />}
            </div>

            <div className="se-layout">
                {/* the setup on top, the bench under a divider */}
                <div className="se-main">
                    <div className="se-groups">
                        {groups.map((g) => (
                            <GroupCard key={g.index} group={g} ui={ui} buffs={partyBuffs.filter((b) => b.groups.includes(g.index))} />
                        ))}
                    </div>
                    <BenchCard bench={setup.bench} ui={ui} />
                </div>
            </div>

            <WeightsModal open={dialog === "weights"} onClose={() => setDialog(null)} data={data} setup={setup} onApply={(w) => propose(w)} />
            <SearchModal open={dialog === "search"} onClose={() => setDialog(null)} ctx={ctx} search={data.search} />
            <ExplainModal open={dialog === "explain"} onClose={() => setDialog(null)} ctx={ctx} data={data} setup={setup} onDone={load} />
        </div>
    );
}
