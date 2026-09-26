// "Event anlegen" (#261), the planning side: the raid step only where the
// EventHelper plans, a calm raid step with the rest behind "Mehr", the
// duration beside the time, channel/voice channel/deadline/source in "Kanal &
// Anmeldung", the leader from a dropdown, "Als Vorlage speichern" without
// touching the event, and the same dialog editing an own event. Rule set: the
// server's real one; the API is mocked at its transport (api/client). The walk
// through the steps and the toasts: RaidCreateDialog.test.tsx; the plan rules:
// lib/eventCreateDialog.test.ts.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import type { Channel, GameVersion, OwnEvent, RaidCreateContext, RaidTemplate } from "../../api";
import { t } from "../../i18n";
import { stepLabel, stepsFor } from "../../lib/eventPlan";
import { requireBackend } from "../../test/backend";
import { inLang } from "../../test/i18n";
import { renderPage } from "../../test/render";
import RaidCreateDialog from "./RaidCreateDialog";

vi.mock("../../api/client", async (orig) => ({ ...(await orig<typeof import("../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const { publicVersions } = requireBackend("config/gameVersions");
const versions: GameVersion[] = publicVersions();

const channel = (id: string, name: string, parentId: string, category: string): Channel => ({ id, name, type: 0, typeLabel: "Text", category, parentId, isThread: false });

const KARA_TEMPLATE: RaidTemplate = {
    id: "tpl1", name: "Kara 10er", versionId: "tbc", instanceIds: ["kara"], size: 10,
    composition: { tank: 2, healer: 3, melee: null, ranged: null }, requiredBuffs: [], signupDeadline: null,
    durationMinutes: 180, fairness: false, wishes: false, raidhelperTemplateId: "7",
};

// Thursday 24 September 2026, 19:45 in Berlin
const LAST_KARA = Math.floor(Date.UTC(2026, 8, 24, 17, 45) / 1000);

function context(over: Partial<RaidCreateContext> = {}): RaidCreateContext {
    return {
        defaults: { templateId: "", channelId: "ch1" },
        categoryTemplates: {},
        leaderId: "u1",
        leaderCandidates: [{ id: "u1", name: "Admin" }, { id: "u2", name: "Bea" }],
        channels: [channel("ch1", "kara-do-24-09", "c1", "T4"), channel("ch2", "gruul-fr", "c2", "T5")],
        voiceChannels: [channel("v1", "Raid 1", "c1", "T4"), channel("v2", "Raid 2", "c2", "T5")],
        categoryVoiceChannel: { c1: "v1" },
        templates: [KARA_TEMPLATE],
        reusableEvents: [{
            id: "e1", title: "Kara Donnerstag", templateId: "", description: "Wie immer", channelId: "ch1", channelName: "kara-do-24-09",
            categoryId: "c1", categoryName: "T4", startTime: LAST_KARA, contentIds: ["kara"],
        }],
        signupSources: { c1: "eventhelper" },
        categories: [{ id: "c1", name: "T4" }, { id: "c2", name: "T5" }],
        raidTemplates: [KARA_TEMPLATE],
        versions,
        defaultVersion: "tbc",
        channelSchemas: { c1: { schema: "{raid}-{wd}-{dd}-{mm}", raid: "" } },
        defaultSchema: "raid-{dd}-{mm}",
        ...over,
    };
}

const EDIT_EVENT: OwnEvent = {
    id: "own1", source: "eventhelper", guildId: "g1", categoryId: "c1", categoryName: "T4", channelId: "ch1", channelName: "kara-do-24-09",
    voiceChannelId: "", title: "Kara Donnerstag", description: "", leaderId: "u1", startTime: LAST_KARA, durationMinutes: 180,
    versionId: "tbc", instanceIds: ["kara"], size: 10, composition: { tank: 2, healer: 3, melee: 0, ranged: 0 },
    compositionMax: { melee: null, ranged: null }, requiredBuffs: [], raidTemplateId: "", signupDeadline: 0,
    fairness: false, wishes: false, autoSuggest: false,
};

let ctx: RaidCreateContext;

beforeEach(() => {
    ctx = context();
    vi.mocked(client.get).mockImplementation((path: string) => {
        if (path.startsWith("/api/raids/new")) return Promise.resolve(ctx);
        if (path.startsWith("/api/raids/channel-name?")) return Promise.resolve({ name: "kara-do-01-10", label: "wie der letzte Kanal", design: "" });
        return Promise.reject({ code: "not_mocked", message: path });
    });
    vi.mocked(client.send).mockImplementation((_m: string, path: string) => Promise.resolve(path === "/api/raid-templates"
        ? { ...KARA_TEMPLATE, id: "tpl2", name: "Neu" }
        : { id: "new1" }));
});

async function open(props: { sourceId?: string; editEventId?: string } = {}) {
    const onCreated = vi.fn();
    const view = renderPage(<RaidCreateDialog open sourceId={props.sourceId || ""} editEventId={props.editEventId} userId="u1" onClose={() => {}} onCreated={onCreated} />);
    await screen.findByRole("list", { name: t("raidCreate.progress") });
    await waitFor(() => expect(screen.queryByText(t(props.editEventId ? "raidCreate.load.event" : "raidCreate.load.templates"))).not.toBeInTheDocument());
    return { ...view, onCreated };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A field by its label (the label carries a small "i" for its tooltip). */
const field = (label: string) => screen.getByLabelText(new RegExp(`^${esc(label)}`));
const stepper = () => screen.getByRole("list", { name: t("raidCreate.progress") });
const currentStep = () => within(stepper()).getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "step")?.textContent;
const next = () => screen.getByRole("button", { name: new RegExp(`^${esc(t("raidCreate.footer.next", { step: "" }).trim())}`) });

describe("Event anlegen: the planning step", () => {
    it("is part of the way only where the EventHelper plans", async () => {
        const user = userEvent.setup();
        await open();
        await user.click(screen.getByRole("radio", { name: /Kara Donnerstag/ }));
        await user.click(next());
        // the event's category plans in the EventHelper
        expect(within(stepper()).getAllByRole("listitem").map((li) => li.textContent?.replace(/^\d/, ""))).toEqual(stepsFor(false, "eventhelper").map(stepLabel));
        // a Raid-Helper category: no raid step
        await user.selectOptions(field(t("raidCreate.termin.category")), "c2");
        expect(within(stepper()).getAllByRole("listitem").map((li) => li.textContent?.replace(/^\d/, ""))).toEqual(stepsFor(false, "raidhelper").map(stepLabel));
    });

    it("starts from a raid template as well as from an event or empty", async () => {
        const user = userEvent.setup();
        await open();
        const tabs = screen.getByRole("radiogroup", { name: t("raidCreate.start.ariaLabel") });
        expect(within(tabs).getAllByRole("radio").map((r) => r.textContent)).toEqual([t("raidCreate.start.tabEvents"), t("raidCreate.templatesLink")]);
        const options = screen.getByRole("radiogroup", { name: t("raidCreate.start.group") });
        expect(within(options).getByRole("radio", { name: new RegExp(t("raidCreate.start.empty")) })).toBeInTheDocument();
        await user.click(within(tabs).getByRole("radio", { name: t("raidCreate.templatesLink") }));
        await user.click(within(options).getByRole("radio", { name: /Kara 10er/ }));
        await user.click(next());
        expect(field(t("raidCreate.termin.title"))).toHaveValue("Kara 10er");
    });
});

describe("Event anlegen: Termin", () => {
    it("puts the duration small beside the time and shows the end, not a second field", async () => {
        const user = userEvent.setup();
        await open({ sourceId: "e1" });
        expect(field(t("raidCreate.termin.time"))).toHaveValue("19:45");
        const duration = screen.getByRole("spinbutton", { name: t("raidCreate.termin.durationAria") });
        await user.clear(duration);
        await user.type(duration, "150");
        expect(screen.getByText(t("raidCreate.termin.end", { time: "22:15" }))).toBeInTheDocument();
    });

    it("picks the leader from the creator and the signed-up people, „other id“ opens a text field", async () => {
        const user = userEvent.setup();
        await open({ sourceId: "e1" });
        await user.click(screen.getByRole("button", { name: "Details", expanded: false }));
        const leader = field(t("raidCreate.termin.leader")) as HTMLSelectElement;
        expect([...leader.options].map((o) => o.textContent)).toEqual([
            t("raidCreate.termin.leaderOptionYou", { name: "Admin" }), "Bea", t("raidCreate.termin.leaderOther"),
        ]);
        expect(screen.queryByRole("textbox", { name: t("raidCreate.termin.leader") })).not.toBeInTheDocument();
        await user.selectOptions(leader, t("raidCreate.termin.leaderOther"));
        expect(screen.getByRole("textbox", { name: t("raidCreate.termin.leader") })).toBeInTheDocument();
    });

    it("has the leader's texts in both languages", async () => {
        const keys = ["leader", "leaderTip", "leaderOptionYou", "leaderOther", "leaderPlaceholder"].map((k) => `raidCreate.termin.${k}`);
        for (const key of keys) expect(t(key)).not.toBe(key);
        await inLang("en", () => {
            for (const key of keys) expect(t(key)).not.toBe(key);
        });
    });
});

describe("Event anlegen: Raid", () => {
    async function atRaid(user: ReturnType<typeof userEvent.setup>) {
        const view = await open({ sourceId: "e1" });
        await user.click(next());
        expect(currentStep()).toContain(stepLabel("raid"));
        return view;
    }

    it("keeps the raid step calm: size and tanks/healers first, the rest behind Mehr, the sum as one badge", async () => {
        const user = userEvent.setup();
        const { container } = await atRaid(user);
        const more = screen.getByText(t("raidCreate.raid.more")).closest("details")!;
        expect(more).not.toHaveAttribute("open");
        const size = screen.getByRole("radiogroup", { name: t("raidPlan.fields.size") });
        const tanks = screen.getByRole("button", { name: t("raidPlan.comp.tankMore") });
        expect(size.compareDocumentPosition(tanks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        for (const first of [size, tanks]) {
            expect(more.contains(first)).toBe(false);
            expect(first.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
        for (const later of [t("raidPlan.fields.look"), t("raidPlan.fields.buffs"), t("wow.role.melee"), t("raidCreate.raid.fairness"), t("raidCreate.raid.wishes"), t("raidCreate.raid.autoSuggest")]) {
            expect(within(more).getAllByText(later).length).toBeGreaterThan(0);
        }
        expect(screen.getByRole("status")).toHaveTextContent(t("raidCreate.raid.planned", { planned: 5, size: 10 })); // Kara: 2 tanks + 3 healers planned
        // explanations sit in tooltips, never as hint paragraphs
        expect(container.ownerDocument.querySelector(".hint")).toBeNull();
    });

    it("saves the plan as a template without touching the event", async () => {
        const user = userEvent.setup();
        await atRaid(user);
        await user.click(screen.getByRole("button", { name: t("raidCreate.raid.saveAsTemplate") }));
        const box = screen.getByRole("group", { name: t("raidCreate.raid.saveAsTemplate") });
        const name = within(box).getByRole("textbox", { name: t("raidCreate.raid.tplName") });
        await user.clear(name);
        await user.type(name, "Kara neu");
        await user.click(within(box).getByRole("button", { name: t("common.save") }));
        await waitFor(() => expect(client.send).toHaveBeenCalledTimes(1));
        const [method, path, body] = vi.mocked(client.send).mock.calls[0];
        expect([method, path]).toEqual(["POST", "/api/raid-templates"]);
        expect(body).toMatchObject({ name: "Kara neu", instanceIds: ["kara"], size: 10 });
        expect(vi.mocked(client.send).mock.calls.some(([, p]) => p === "/api/raids")).toBe(false);
    });
});

describe("Event anlegen: Kanal & Anmeldung", () => {
    it("names the channel, presets source and voice channel from the category and sends everything with the event", async () => {
        const user = userEvent.setup();
        const { onCreated } = await open({ sourceId: "e1" });
        await user.click(next());
        await user.click(next());
        expect(currentStep()).toContain(stepLabel("kanal"));
        const source = screen.getByRole("radiogroup", { name: t("raidCreate.kanal.source") });
        expect(within(source).getByRole("radio", { name: /EventHelper/ })).toHaveAttribute("aria-checked", "true");
        const mode = screen.getByRole("radiogroup", { name: t("raidCreate.kanal.channel") });
        expect(within(mode).getByRole("radio", { name: t("raidCreate.kanal.modeNew") })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole("textbox", { name: new RegExp(`^${esc(t("raidCreate.kanal.channel"))}`) })).toHaveValue("kara-do-01-10"));
        expect(field(t("raidCreate.kanal.voice"))).toHaveValue("v1");
        expect(field(t("raidCreate.kanal.deadline"))).toBeInTheDocument();
        // the event plans in the EventHelper: no Raid-Helper template to pick
        expect(screen.queryByLabelText(new RegExp(`^${esc(t("raidCreate.kanal.rhTemplate"))}`))).not.toBeInTheDocument();

        await user.click(next());
        await user.click(screen.getByRole("button", { name: t("raidCreate.footer.create") }));
        await waitFor(() => expect(onCreated).toHaveBeenCalled());
        const [method, path, body] = vi.mocked(client.send).mock.calls[0];
        expect([method, path]).toEqual(["POST", "/api/raids"]);
        expect(body).toMatchObject({ title: "Kara Donnerstag", signupSource: "eventhelper", voiceChannelId: "v1", durationMinutes: 180 });
    });

    it("keeps the Raid-Helper template select for a Raid-Helper event", async () => {
        const user = userEvent.setup();
        await open({ sourceId: "e1" });
        await user.selectOptions(field(t("raidCreate.termin.category")), "c2");
        await user.click(next());
        expect(currentStep()).toContain(stepLabel("kanal"));
        const template = field(t("raidCreate.kanal.rhTemplate")) as HTMLSelectElement;
        expect([...template.options].map((o) => o.value)).toContain("7");
        expect(screen.queryByLabelText(new RegExp(`^${esc(t("raidCreate.kanal.voice"))}`))).not.toBeInTheDocument();
    });
});

describe("Event anlegen: editing an own event", () => {
    it("starts at the event itself and saves through PATCH /api/raids", async () => {
        const user = userEvent.setup();
        ctx = context({ editEvent: EDIT_EVENT });
        const { onCreated } = await open({ editEventId: "own1" });
        expect(client.get).toHaveBeenCalledWith("/api/raids/new?event=own1");
        expect(screen.getByText(t("raidCreate.footer.titleEdit"))).toBeInTheDocument();
        expect(currentStep()).toContain(stepLabel("termin"));
        const title = field(t("raidCreate.termin.title"));
        expect(title).toHaveValue("Kara Donnerstag");
        await user.clear(title);
        await user.type(title, "Kara Freitag");
        await user.click(next());
        await user.click(next());
        await user.click(next());
        await user.click(screen.getByRole("button", { name: t("common.save") }));
        await waitFor(() => expect(onCreated).toHaveBeenCalled());
        const [method, path, body] = vi.mocked(client.send).mock.calls[0];
        expect([method, path]).toEqual(["PATCH", "/api/raids"]);
        expect(body).toMatchObject({ id: "own1", title: "Kara Freitag" });
    });
});
