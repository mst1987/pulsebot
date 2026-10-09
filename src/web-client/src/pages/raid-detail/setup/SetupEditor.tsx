// Tab "Setup" of an own event (#263): the proposal, the orga's changes, the
// approval. Kept calm on purpose — ONE toolbar line (the setup's one state,
// "Tanks 3 von 3 · … · 23 von 25 bestätigt", "Mehr ▾", "Alle bestätigen" and the
// one primary button: "Setup posten" until it is out, then "Alle pingen"), the
// group cards right under it with one compact line per raider, the bench and
// "Angemeldet" as rows, and one summary line (buffs, fairness, wishes, "nicht
// zusammen" — asked once, counts only, never names) whose "Details" opens the
// tiles and switches. Everything rarer sits under "Mehr": proposing anew, the
// group count, the ping text, the switches, the weights, Claude's explanation.
// A click on a raider opens their details in a side drawer.
//
// Moving: drag a raider onto a group, onto the bench, back into "Angemeldet"
// (the pool of who signed up and is neither placed nor benched, #517) or onto
// another raider (swap — inside one group that reorders it; every group always
// shows its five places). Without a mouse: activate a raider (click, Enter),
// then the target. Every move is saved at once and comes back valued by the
// server. Posting carries the bench only with "Bench mitposten" ticked.

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { approveRaidSetup, getRaidSetup, pingSetup, previewSetupPing, proposeRaidSetup, publishRaidSetup, saveRaidSetup, saveSetupExtraRole, saveSetupPingText, saveSetupSignup, setSetupConfirmation, confirmAllSetup, updateRaidSize, type ApiError, type SetupConfirmation, type SetupEditorData, type SetupPerson, type SetupPlacementInput, type SetupSignupInput, type SetupActivity, type SetupPresenceAction, type StoredSetup } from "../../../api";
import { useApi } from "../../../hooks/useApi";
import { applyLocal, moveRaider, peopleOf, publishHint, resizeLineup, respecRaider, setupState, suggestGroup, toInput, toggleLock, withAllGroups, withSetupDefaults, GROUP_SIZE, type SetupTarget } from "../../../lib/signups/setupEditor";
import { useT } from "../../../i18n";
import { Button, IconButton } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import { useConfirm } from "../../../components/ui/Modal";
import RaidLoader from "../../../components/ui/RaidLoader";
import WowIcon from "../../../components/ui/WowIcon";
import { useJobs } from "../../../components/shell/Jobs";
import { LockIcon, XIcon } from "../../../components/ui/icons";
import type { RaidCtx } from "../meta";
import "../../../styles/setup-editor.css";
import { clock, readCompact, storeCompact } from "./setupText";
import { BenchCard, GroupCard, type Interaction, ReadOnly } from "./Board";
import { PoolPanel } from "./PoolPanel";
import { ActivityFeed, PresenceChip } from "./LiveParts";
import { presenceColor, usePresence } from "./usePresence";
import { MoreMenu, PingTextField, SizeControl, StatusBadge, type MoreItem } from "./Controls";
import { Summary, SummaryLine } from "./Summary";
import { roleFigures, summaryOptions } from "./summaryFigures";
import { SlotTip, type SlotActions } from "./SlotTip";
import { EditorDialog, ExplainModal, FillModal, WeightsModal } from "./SetupModals";
import Switch from "../../../components/ui/Switch";
import { SearchModal } from "./SearchModal";
import { SignupEditModal } from "./SignupEditModal";

export default function SetupEditor({ ctx }: { ctx: RaidCtx }) {
    const t = useT();
    const jobs = useJobs();
    const ask = useConfirm();
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);
    // the dialogs: the rare tools under "Mehr", and the summary line's "Details"
    const [dialog, setDialog] = useState<"weights" | "explain" | "search" | "size" | "ping" | "details" | "fill" | null>(null);
    const [posting, setPosting] = useState(false);
    const [pinging, setPinging] = useState(false);
    // "Anmeldung bearbeiten" (#521): the raider whose signup the dialog changes
    const [editing, setEditing] = useState<string | null>(null);
    // "Bench mitposten" (#517): null = what the event remembered from the last post (off by default)
    const [benchChoice, setBenchChoice] = useState<boolean | null>(null);
    // "DMs an Spieler": null = what the event (else its category) says; sent with the next post
    const [dmsChoice, setDmsChoice] = useState<boolean | null>(null);
    const [compact, setCompact] = useState(readCompact);
    const toggleCompact = () => setCompact((on) => {
        storeCompact(!on);
        return !on;
    });
    const saving = useRef(0);

    const setupData = useApi(() => getRaidSetup(ctx.eventId).then((d) => (d.setup ? { ...d, setup: withSetupDefaults(d.setup) } : d)), [ctx.eventId]);
    const { data, setData } = setupData;
    const load = setupData.reload;

    // The raider the side drawer shows: the one clicked last (nothing stands open
    // before a click). Unlike `selected` (picked to be moved — the next raider
    // clicked is swapped with it) it outlives a panel action: confirm, fix or edit
    // drop the pick, the drawer stays, and the next click on a raider just picks
    // that one. Esc or its close button lets go.
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

    // Who else is in this editor (setupPresence): what this orga member holds goes out with
    // every heartbeat, the others are drawn in the bar and on the raiders they hold, and what
    // they just moved glows a moment with their name.
    const myAction: SetupPresenceAction | null = dragging ? { kind: "drag", userId: dragging }
        : selected ? { kind: "drag", userId: selected }
            : editing ? { kind: "edit", userId: editing } : null;
    const [flash, setFlash] = useState<Record<string, { name: string; color: string }>>({});
    const flashFor = (entries: SetupActivity[]) => {
        const lit: Record<string, { name: string; color: string }> = {};
        for (const e of entries) {
            const ids = e.kind === "move" && e.userId ? [e.userId] : e.kind === "many" ? (e.userIds || []) : [];
            for (const id of ids) lit[id] = { name: e.byName, color: presenceColor(e.by) };
        }
        if (!Object.keys(lit).length) return;
        setFlash((prev) => ({ ...prev, ...lit }));
        setTimeout(() => setFlash((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !(id in lit)))), 4000);
    };
    const presence = usePresence(ctx.eventId, myAction, { enabled: !!data?.canWrite, onNew: flashFor });
    const postBench = benchChoice ?? !!data?.publish?.bench;
    const postDms = dmsChoice ?? !!data?.publish?.dmsEnabled;

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

    // Somebody else changed the setup (the heartbeat says a newer version is stored): fetch it
    // light — no names, no attendance; the page keeps its own — unless a move of ours is on its way.
    const syncing = useRef(false);
    useEffect(() => {
        if (!presence.version || presence.version <= confirmedVersion.current || saving.current || syncing.current) return;
        syncing.current = true;
        getRaidSetup(ctx.eventId, { light: true })
            .then((next) => {
                if (saving.current || !next.setup || next.setup.version <= confirmedVersion.current) return;
                confirmedVersion.current = next.setup.version;
                setData({ ...withNames(next), attendance: current.current?.attendance || next.attendance });
            })
            // a failed fetch is no news: the next heartbeat asks again
            .catch(() => undefined)
            .finally(() => { syncing.current = false; });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [presence.version]);

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
    // `redo`: the move once more on a newer lineup — when somebody else saved in
    // between (409 "conflict"), the move is applied to their lineup and saved again
    // instead of "changed in the meantime, reload".
    const save = (input: SetupPlacementInput, extra: { fairness?: boolean; wishes?: boolean; avoid?: boolean } = {}, patch: Partial<SetupEditorData> = {}, redo?: (fresh: StoredSetup) => SetupPlacementInput | null) => {
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
                if ((e as ApiError).code === "conflict" && redo && await replay(redo, extra, ticket)) return;
                saving.current = 0;
                jobs.notify((e as ApiError).message || t("setup.editor.saveFailed"), "err");
                load();
            }
        });
        return chain.current;
    };

    /** A move that met a newer lineup: fetch it, apply the move there, save again — true when that worked. */
    const replay = async (redo: (fresh: StoredSetup) => SetupPlacementInput | null, extra: { fairness?: boolean; wishes?: boolean; avoid?: boolean }, ticket: number) => {
        try {
            const fresh = withNames(await getRaidSetup(ctx.eventId, { light: true }));
            const again = fresh.setup ? redo(withSetupDefaults(fresh.setup)) : null;
            if (!fresh.setup || !again) return false;
            const next = await saveRaidSetup(ctx.eventId, { ...again, ...extra, version: fresh.setup.version });
            if (next.setup) confirmedVersion.current = next.setup.version;
            if (ticket === saving.current) {
                saving.current = 0;
                accept(next, next.message);
            }
            jobs.notify(t("setup.live.rebased"));
            return true;
        } catch {
            return false;
        }
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
        const redo = (fresh: StoredSetup) => {
            const again = moveRaider(toInput(fresh), who, target, peopleOf(fresh), shown.event.size || 0);
            return "input" in again && again.input ? again.input : null;
        };
        if (result.input) save(result.input, {}, {}, redo);
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

    /** A proposal: everything anew (fixed places kept), or — `keep: "placed"`, "Freie Plätze füllen" — only the free places. */
    const propose = async (weights?: Record<string, number>, keep?: "placed") => {
        setDialog(null);
        const avoid = await avoidAnswer();
        setBusy(true);
        await chain.current;
        const next = await jobs.run({ label: t("setup.editor.proposalJob"), detail: data?.event.title || "", icon: "inv_misc_map_01", quiet: true }, () => (
            proposeRaidSetup(ctx.eventId, { ...(weights ? { weights } : {}), ...(avoid === undefined ? {} : { avoid }), ...(keep ? { keep } : {}) })
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
            const next = await approveRaidSetup(ctx.eventId, confirmedVersion.current, { bench: postBench, dms: postDms });
            accept(next, next.message);
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.approveFailed"), "err");
            load();
        } finally {
            setBusy(false);
        }
    };

    /**
     * "Alle pingen" — the posted setup's one action: everybody in its groups, in the
     * event channel, with the ping text (the web's twin of "Ping everyone" under the
     * message). Asks first, with how many and the text, from the server's dry run.
     */
    const pingAll = async () => {
        setPinging(true);
        try {
            const plan = await previewSetupPing(ctx.eventId);
            const ok = await ask({
                title: t("setup.ping.askTitle"),
                text: t("setup.ping.askText", { count: plan.count, text: plan.text }),
                action: t("setup.ping.action"),
                icon: "inv_letter_15",
                tone: "primary",
            });
            if (!ok) return;
            const r = await pingSetup(ctx.eventId);
            jobs.notify(r.message);
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.ping.failed"), "err");
        } finally {
            setPinging(false);
        }
    };

    const post = async () => {
        setPosting(true);
        try {
            await chain.current;
            const next = await publishRaidSetup(ctx.eventId, { bench: postBench, dms: postDms });
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

    /** "Alle bestätigen": asked once, then — after the marks still on their way — the check for everybody in a group without an answer. */
    const confirmEveryone = async (count: number) => {
        const ok = await ask({
            title: t("setup.confirmAll.askTitle"),
            text: t("setup.confirmAll.askText", { count }),
            action: t("setup.editor.confirmAll"),
            icon: "achievement_guildperk_everybodysfriend",
            tone: "primary",
        });
        if (!ok) return;
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
    // The drawer shows the raider clicked last (`pinned`) — looked up fresh every
    // render, so a move redraws its group and buffs. Nothing stands open before a click.
    const shownId = pinned && peopleOf(setup).has(pinned) ? pinned : null;
    const inspectedPerson = shownId ? peopleOf(setup).get(shownId) : undefined;
    const editPerson = editing ? peopleOf(setup).get(editing) : undefined;
    // on the bench or in the pool: no slot yet, so no "im Setup als" and no extra role
    const inspectedIsBench = !!inspectedPerson && [...setup.bench, ...(setup.pool || [])].some((b) => b.userId === inspectedPerson.userId);
    const inspectedInPool = !!inspectedPerson && (setup.pool || []).some((b) => b.userId === inspectedPerson.userId);
    const inspectedInGroup = !!inspectedPerson && setup.groups.some((g) => g.slots.some((s) => s.userId === inspectedPerson.userId));
    const confirmations = data.confirmations || {};
    // hovering a raider no longer opens anything — a click does (the drawer)
    // what the others hold right now, by raider — ringed in their colour, not to be taken meanwhile
    const held: NonNullable<Interaction["held"]> = {};
    for (const e of presence.editors) if (e.action) held[e.action.userId] = { name: e.name, color: presenceColor(e.userId), kind: e.action.kind };
    const characters = new Map([...peopleOf(setup).values()].map((p) => [p.userId, p.character]));
    const onHeld = (userId: string) => {
        const h = held[userId];
        if (h) jobs.notify(t(h.kind === "edit" ? "setup.live.editsMsg" : "setup.live.holdsMsg", { name: h.name, character: characters.get(userId) || "?" }));
    };
    const ui: Interaction = { held, flash, onHeld, editable: !busy, selected, dragging, attendance: data.attendance || {}, extraRoles: data.extraRoles || {}, suggest, onInspect: () => undefined, onPick: pick, onDrop: move, onDrag: setDragging, onEdit: setEditing, confirmations, pinned: shownId };
    const closeDrawer = () => {
        setPinned(null);
        setSelected(null);
    };
    // the actions on the raider shown (SlotTip) — the check only for a group place of a posted (= approved) setup
    const actions: SlotActions = inspectedPerson && !busy ? {
        confirmation: inspectedInGroup ? confirmations[inspectedPerson.userId] : undefined,
        onConfirm: inspectedInGroup && setup.status === "approved" ? act(() => toggleConfirm(inspectedPerson.userId)) : undefined,
        locked: !!inspectedPerson.locked,
        onLock: inspectedInPool ? undefined : act(() => void save(toggleLock(toInput(current.current?.setup || setup), inspectedPerson.userId))),
        onEdit: act(() => setEditing(inspectedPerson.userId)),
    } : {};
    // who in the groups has no answer yet — "Alle bestätigen" is there only while somebody is left
    const placed = setup.groups.reduce((n, g) => n + g.slots.length, 0);
    const unanswered = setup.groups.reduce((n, g) => n + g.slots.filter((s) => !confirmations[s.userId]).length, 0);
    const confirmed = setup.groups.reduce((n, g) => n + g.slots.filter((s) => confirmations[s.userId] === "confirmed").length, 0);
    const groups = withAllGroups(setup.groups, data.groupCount || 1);
    const partyBuffs = setup.checks.buffs.party;
    const lockedCount = [...setup.groups.flatMap((g) => g.slots), ...setup.bench].filter((p) => p.locked).length;
    const size = setup.checks.size;
    const approved = setup.status === "approved";
    const cancelled = !!data.publish?.cancelled;
    // ONE state (never "Gepostet" beside "noch nicht gepostet") and ONE primary button that follows it;
    // the switches "Bank mitposten" / "DMs an Spieler" count as soon as they are flipped, before the post sends them
    const publish = data.publish ? { ...data.publish, dmsEnabled: postDms } : data.publish;
    const state = setupState(setup, publish);
    const hint = publishHint(publish, approved, clock);
    // a switch flipped after the post: "Setup posten" applies it (the bench into the message, the DMs still open)
    const optionsChanged = !!data.publish && ((benchChoice !== null && benchChoice !== !!data.publish.bench) || (dmsChoice !== null && dmsChoice !== !!data.publish.dmsEnabled));
    const poolCount = (setup.pool || []).length;
    // the proposal is a tool now, not the start: fill everything, or only the free places once somebody stands
    const canFill = !cancelled && poolCount > 0 && placed < (data.event.size || 0);
    const fill = () => (placed === 0 ? void propose() : setDialog("fill"));
    const opts = summaryOptions(data, setup);
    const keep = () => toInput(current.current?.setup || setup);

    let primary: ReactNode = null;
    if (!cancelled && !approved) {
        primary = (
            <Button icon="inv_letter_15" disabled={busy || placed === 0} data-tip={t("setup.editor.approve")} data-tip-sub={t("setup.editor.approveSub")} onClick={approve}>
                {t("setup.editor.approve")}
            </Button>
        );
    } else if (!cancelled && (state.needsPost || optionsChanged)) {
        primary = (
            <Button icon="inv_letter_15" running={posting || !!hint?.running} disabled={busy} data-tip={t("setup.publishLine.post")} data-tip-sub={t("setup.publishLine.postSub")} onClick={post}>
                {t("setup.publishLine.post")}
            </Button>
        );
    } else if (!cancelled) {
        primary = (
            <Button icon="spell_holy_prayerofspirit" running={pinging} disabled={busy} data-tip={t("setup.ping.button")} data-tip-sub={t("setup.ping.buttonSub")} onClick={() => void pingAll()}>
                {t("setup.ping.button")}
            </Button>
        );
    }

    const more: (MoreItem | "sep")[] = [
        { id: "repropose", label: t("setup.editor.repropose"), sub: t("setup.more.reproposeSub"), icon: "spell_holy_borrowedtime", disabled: busy, onSelect: () => void propose() },
        { id: "size", label: t("setup.more.size"), sub: t("setup.more.sizeSub", { groups: Math.max(1, Math.ceil((data.event.size || 0) / GROUP_SIZE)), size: data.event.size || 0 }), icon: "achievement_guildperk_everybodysfriend", disabled: busy, onSelect: () => setDialog("size") },
        { id: "ping", label: t("setup.pingText.title"), sub: data.pingText || t("setup.more.pingDefault"), icon: "inv_letter_15", disabled: busy, onSelect: () => setDialog("ping") },
        "sep",
        { id: "fairness", label: t("setup.summary.fairness"), sub: t("setup.summary.fairnessCap"), icon: "spell_holy_divineintervention", on: opts.fairness, disabled: busy, onSelect: () => void save(keep(), { fairness: !opts.fairness }) },
        { id: "wishes", label: t("setup.summary.wishes"), sub: opts.wishes ? t("setup.summary.wishesCapOn", { met: setup.checks.wishes.met, total: setup.checks.wishes.total }) : t("setup.more.wishesOffSub"), icon: "inv_valentineschocolate02", on: opts.wishes, disabled: busy, onSelect: () => void save(keep(), { wishes: !opts.wishes }) },
        ...(opts.avoidTotal > 0 ? [{ id: "avoid", label: t("setup.summary.avoid"), sub: t("setup.summary.avoidSub", { count: opts.avoidTotal }), icon: "ability_creature_cursed_02", on: opts.avoid, disabled: busy, onSelect: () => void save(keep(), { avoid: !opts.avoid }) }] : []),
        "sep",
        // posted and current: posting again sends the DMs a live change left open, or redraws the message
        ...(approved && !state.needsPost && hint?.canPost ? [{ id: "repost", label: t("setup.publishLine.post"), sub: t("setup.publishLine.postSub"), icon: "inv_letter_15", disabled: busy || posting, onSelect: () => void post() }] : []),
        { id: "compact", label: t("setup.editor.compact"), sub: t("setup.editor.compactSub"), icon: "inv_misc_book_09", on: compact, onSelect: toggleCompact },
        { id: "search", label: t("setup.editor.search"), sub: t("setup.editor.searchSub"), icon: "inv_misc_spyglass_02", disabled: !data.search, onSelect: () => setDialog("search") },
        { id: "explain", label: t("setup.editor.explain"), sub: t("setup.editor.explainSub"), icon: "inv_scroll_03", onSelect: () => setDialog("explain") },
        { id: "weights", label: t("setup.summary.weights"), sub: t("setup.editor.weightsSub"), icon: "inv_misc_gear_01", disabled: busy, onSelect: () => setDialog("weights") },
    ];

    const figures = roleFigures(setup);
    const counts: ReactNode[] = figures.map((f) => (
        <span
            key={f.key} className={f.ok ? undefined : "se-off"}
            data-tip={f.target ? t("setup.summary.statTipTarget", { label: f.label, value: f.value, target: f.target }) : t("setup.summary.statTip", { label: f.label, value: f.value })}
            data-tip-sub={f.tip}
        >
            {f.label} <b>{f.target ? (/^\d+$/.test(f.target) ? t("setup.bar.ofTarget", { value: f.value, target: f.target }) : t("setup.bar.withTarget", { value: f.value, target: f.target })) : f.value}</b>
        </span>
    ));
    if (!size.ok) {
        counts.push(
            <span key="places" className="se-off" data-tip={t("setup.editor.placesTip")} data-tip-sub={t("setup.editor.placesSub", { count: size.count, size: size.size, bench: setup.bench.length })}>
                <b>{t("setup.bar.places", { count: size.count, size: size.size })}</b>
            </span>,
        );
    }
    if (approved && placed > 0) {
        counts.push(
            <span key="confirmed" className="se-counts-ok" data-tip={t("setup.bar.confirmedTip")} data-tip-sub={t("setup.bar.confirmedSub")}>
                <b>{t("setup.bar.confirmed", { count: confirmed, total: placed })}</b>
            </span>,
        );
    }

    return (
        <div className={`se-editor${compact ? " se-compact" : ""}`}>
            {/* ONE toolbar line: the state, the counts, then "Mehr", "Alle bestätigen" and the one primary button */}
            <div className="se-bar">
                <StatusBadge setup={setup} publish={data.publish} />
                <PresenceChip editors={presence.editors} names={characters} />
                {/* while a raider is picked the counts make room for where to click next */}
                {selected
                    ? <span className="se-bar-pick">{t("setup.editor.pickTarget")}</span>
                    : (
                        <span className="se-counts">
                            {counts.map((c, i) => <Fragment key={i}>{i > 0 && <span className="se-counts-dot" aria-hidden="true">·</span>}{c}</Fragment>)}
                        </span>
                    )}
                {lockedCount > 0 && (
                    <Badge tone="accent" icon={<LockIcon />} tip={t("setup.editor.lockedTip")} tipSub={t("setup.editor.lockedSub")}>
                        {t("setup.editor.locked", { count: lockedCount })}
                    </Badge>
                )}
                <div className="se-bar-act">
                    <MoreMenu items={more} />
                    {canFill && (
                        <Button
                            variant="ghost" size="sm" icon="spell_holy_borrowedtime" running={busy} disabled={busy}
                            data-tip={placed === 0 ? t("setup.fill.auto") : t("setup.fill.free")} data-tip-sub={placed === 0 ? t("setup.fill.autoSub") : t("setup.fill.freeSub")}
                            onClick={fill}
                        >
                            {placed === 0 ? t("setup.fill.auto") : t("setup.fill.free")}
                        </Button>
                    )}
                    {approved && unanswered > 0 && (
                        <Button
                            variant="ghost" size="sm" icon="achievement_guildperk_everybodysfriend" disabled={busy}
                            data-tip={t("setup.editor.confirmAll")} data-tip-sub={t("setup.editor.confirmAllSub")}
                            onClick={() => void confirmEveryone(unanswered)}
                        >
                            {t("setup.editor.confirmAll")}
                        </Button>
                    )}
                    {/* what posting sends along — visible, no detour through "Mehr" */}
                    {!cancelled && data.publish && (
                        <div className="se-postopts" role="group" aria-label={t("setup.postOptions.aria")}>
                            <Switch className="se-postopt" checked={postBench} disabled={busy} label={t("setup.postOptions.bench")} tip={t("setup.postOptions.benchSub")} onChange={setBenchChoice} />
                            <Switch
                                className="se-postopt" checked={postDms} disabled={busy} label={t("setup.postOptions.dms")}
                                tip={postDms === !!data.publish.dmsDefault ? t("setup.postOptions.dmsSub") : t("setup.postOptions.dmsSubOwn")}
                                onChange={setDmsChoice}
                            />
                        </div>
                    )}
                    {primary}
                </div>
            </div>

            {/* a container of its own: the side column for "Angemeldet" or, where too narrow, its dock at the bottom (setup-editor.css) */}
            <div className="se-stage">
                <div className={`se-layout${poolCount > 0 ? " se-with-pool" : ""}`}>
                    {/* the groups right under the bar, the bench as a row under them, then one summary line — "Angemeldet" (#517) beside them */}
                    <div className="se-main">
                        <div className="se-groups">
                            {groups.map((g) => (
                                <GroupCard key={g.index} group={g} ui={ui} buffs={partyBuffs.filter((b) => b.groups.includes(g.index))} />
                            ))}
                        </div>
                        <BenchCard bench={setup.bench} ui={ui} />
                        <SummaryLine data={data} setup={setup} onDetails={() => setDialog("details")} />
                        <ActivityFeed activity={presence.activity} />
                    </div>
                    <PoolPanel pool={setup.pool || []} ui={ui} absent={data.absent || 0} />
                </div>
            </div>

            {/* the raider's details: a side drawer that a click opens, never an empty box */}
            {inspectedPerson && (
                <div className="se-drawer">
                    <div className="se-drawer-head">
                        <span className="kicker">{t("setup.drawer.kicker")}</span>
                        <IconButton icon={<XIcon />} tip={t("common.close")} size="sm" onClick={closeDrawer} />
                    </div>
                    <SlotTip
                        p={inspectedPerson} attendance={data.attendance ? data.attendance[inspectedPerson.userId] : undefined}
                        extra={(data.extraRoles || {})[inspectedPerson.userId] || []}
                        onExtra={inspectedIsBench ? undefined : (role, on) => void toggleExtra(inspectedPerson.userId, role, on)}
                        onSpec={busy || inspectedIsBench ? undefined : (key) => respec(inspectedPerson.userId, key)}
                        actions={actions} pinned={selected === shownId}
                    />
                </div>
            )}

            <EditorDialog open={dialog === "size"} onClose={() => setDialog(null)} icon="achievement_guildperk_everybodysfriend" title={t("setup.more.size")}>
                <SizeControl size={data.event.size} disabled={busy} onCommit={resize} />
            </EditorDialog>
            <EditorDialog open={dialog === "ping"} onClose={() => setDialog(null)} icon="inv_letter_15" title={t("setup.pingText.title")}>
                <PingTextField value={data.pingText || ""} disabled={busy} onSave={savePingText} />
            </EditorDialog>
            <EditorDialog open={dialog === "details"} onClose={() => setDialog(null)} icon="inv_misc_map_01" title={t("setup.line.detailsTitle")} width={640}>
                <Summary
                    data={data} setup={setup} busy={busy}
                    onFairness={(on) => save(keep(), { fairness: on })}
                    onWishes={(on) => save(keep(), { wishes: on })}
                    onAvoid={(on) => save(keep(), { avoid: on })}
                />
            </EditorDialog>
            <FillModal open={dialog === "fill"} onClose={() => setDialog(null)} placed={placed} free={Math.max(0, (data.event.size || 0) - placed)} onFill={(keepPlaced) => void propose(undefined, keepPlaced ? "placed" : undefined)} />
            <WeightsModal open={dialog === "weights"} onClose={() => setDialog(null)} data={data} setup={setup} onApply={(w) => propose(w)} />
            <SearchModal open={dialog === "search"} onClose={() => setDialog(null)} ctx={ctx} search={data.search} />
            {editPerson && <SignupEditModal key={editPerson.userId} eventId={ctx.eventId} person={editPerson} onClose={() => setEditing(null)} onSave={saveSignup} />}
            <ExplainModal open={dialog === "explain"} onClose={() => setDialog(null)} ctx={ctx} data={data} setup={setup} onDone={load} />
        </div>
    );
}
