// "Event anlegen": what keeps a step from going on and what a failed save does.
// Each step's "Weiter" waits for what that step needs (Termin: title, date,
// time; Raid: a plan that fits; Kanal: a channel and, for Raid-Helper, its
// template), and a refused create stays in the dialog with the server's reason
// as a toast. The walk itself: RaidCreateDialog.test.tsx and .plan.test.tsx.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import type { Channel, GameVersion, RaidCreateContext } from "../../api";
import { t } from "../../i18n";
import { PLAN_MAX_DURATION, PLAN_MIN_DURATION, stepLabel } from "../../lib/eventPlan";
import { requireBackend } from "../../test/backend";
import { renderPage } from "../../test/render";
import RaidCreateDialog from "./RaidCreateDialog";

vi.mock("../../api/client", async (orig) => ({ ...(await orig<typeof import("../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const { publicVersions } = requireBackend("config/gameVersions");
const versions: GameVersion[] = publicVersions();

const channel = (id: string, name: string, parentId: string, category: string): Channel => ({ id, name, type: 0, typeLabel: "Text", category, parentId, isThread: false });

// Thursday 24 September 2026, 19:45 in Berlin
const LAST_KARA = Math.floor(Date.UTC(2026, 8, 24, 17, 45) / 1000);

function context(over: Partial<RaidCreateContext> = {}): RaidCreateContext {
    return {
        defaults: { templateId: "", channelId: "ch1" },
        categoryTemplates: {},
        leaderId: "u1",
        leaderCandidates: [{ id: "u1", name: "Admin" }],
        channels: [channel("ch1", "kara-do-24-09", "c1", "T4"), channel("ch2", "gruul-fr", "c2", "T5")],
        voiceChannels: [],
        templates: [],
        reusableEvents: [{
            id: "e1", title: "Kara Donnerstag", templateId: "", description: "", channelId: "ch1", channelName: "kara-do-24-09",
            categoryId: "c1", categoryName: "T4", startTime: LAST_KARA, contentIds: ["kara"],
        }],
        signupSources: { c1: "eventhelper" },
        categories: [{ id: "c1", name: "T4" }, { id: "c2", name: "T5" }],
        raidTemplates: [],
        versions,
        defaultVersion: "tbc",
        channelSchemas: { c1: { schema: "{raid}-{wd}-{dd}-{mm}", raid: "" } },
        defaultSchema: "raid-{dd}-{mm}",
        ...over,
    };
}

let ctx: RaidCreateContext;
let createResult: () => Promise<unknown>;

beforeEach(() => {
    ctx = context();
    createResult = () => Promise.resolve({ id: "new1" });
    vi.mocked(client.get).mockImplementation((path: string) => {
        if (path.startsWith("/api/raids/new")) return Promise.resolve(ctx);
        if (path.startsWith("/api/raids/channel-name?")) return Promise.resolve({ name: "kara-do-01-10", label: "wie der letzte Kanal", design: "" });
        return Promise.reject({ code: "not_mocked", message: path });
    });
    vi.mocked(client.send).mockImplementation(() => createResult() as Promise<never>);
});

async function open(props: { sourceId?: string } = {}) {
    const onCreated = vi.fn();
    renderPage(<RaidCreateDialog open sourceId={props.sourceId || ""} userId="u1" onClose={() => {}} onCreated={onCreated} />);
    await screen.findByRole("list", { name: t("raidCreate.progress") });
    await waitFor(() => expect(screen.queryByText(t("raidCreate.load.templates"))).not.toBeInTheDocument());
    return { onCreated };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const field = (label: string) => screen.getByLabelText(new RegExp(`^${esc(label)}`), { selector: "input, select, textarea" });
const stepper = () => screen.getByRole("list", { name: t("raidCreate.progress") });
const currentStep = () => within(stepper()).getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "step")?.textContent;
const next = () => screen.getByRole("button", { name: new RegExp(`^${esc(t("raidCreate.footer.next", { step: "" }).trim())}`) });

describe("Event anlegen: validation", () => {
    it("goes on from Termin only with a title, a date and a time", async () => {
        const user = userEvent.setup();
        await open();
        await user.click(screen.getByRole("radio", { name: new RegExp(esc(t("raidCreate.start.empty"))) }));
        await user.click(next());
        expect(currentStep()).toContain(stepLabel("termin"));
        expect(next()).toBeDisabled();
        await user.type(field(t("raidCreate.termin.title")), "Gruul");
        expect(next()).toBeDisabled();
        await user.type(field(t("raidCreate.termin.date")), "2026-10-01");
        await user.type(field(t("raidCreate.termin.time")), "20:00");
        expect(next()).toBeEnabled();
        await user.clear(field(t("raidCreate.termin.title")));
        expect(next()).toBeDisabled();
        await user.type(field(t("raidCreate.termin.title")), "   ");
        expect(next()).toBeDisabled();
    });

    it("stops at the raid step while the plan does not hold, and says why", async () => {
        const user = userEvent.setup();
        await open({ sourceId: "e1" });
        const duration = () => screen.getByRole("spinbutton", { name: t("raidCreate.termin.durationAria") });
        await user.clear(duration());
        await user.type(duration(), "5");
        await user.click(next());
        expect(currentStep()).toContain(stepLabel("raid"));
        expect(screen.getByRole("status")).toHaveTextContent(t("raidPlan.problem.duration", { min: PLAN_MIN_DURATION, max: PLAN_MAX_DURATION }));
        expect(next()).toBeDisabled();
        await user.click(screen.getByRole("button", { name: t("raidCreate.footer.back") }));
        await user.clear(duration());
        await user.type(duration(), "180");
        await user.click(next());
        expect(screen.getByRole("status")).toHaveTextContent(t("raidCreate.raid.planned", { planned: 5, size: 10 }));
        expect(next()).toBeEnabled();
    });

    it("needs a channel name for a new channel and a picked channel for an existing one", async () => {
        const user = userEvent.setup();
        await open({ sourceId: "e1" });
        await user.click(next());
        await user.click(next());
        expect(currentStep()).toContain(stepLabel("kanal"));
        const name = await screen.findByRole("textbox", { name: new RegExp(`^${esc(t("raidCreate.kanal.channel"))}`) });
        await waitFor(() => expect(name).toHaveValue("kara-do-01-10"));
        expect(next()).toBeEnabled();
        await user.clear(name);
        expect(next()).toBeDisabled();
        const mode = screen.getByRole("radiogroup", { name: t("raidCreate.kanal.channel") });
        await user.click(within(mode).getByRole("radio", { name: t("raidCreate.kanal.modeExisting") }));
        expect(next()).toBeDisabled();
        await user.selectOptions(field(t("raidCreate.kanal.channel")), "ch1");
        expect(next()).toBeEnabled();
    });

    it("needs a Raid-Helper template for a Raid-Helper event", async () => {
        const user = userEvent.setup();
        await open({ sourceId: "e1" });
        await user.selectOptions(field(t("raidCreate.termin.category")), "c2");
        await user.click(next());
        expect(currentStep()).toContain(stepLabel("kanal"));
        expect(field(t("raidCreate.kanal.rhTemplate"))).toHaveValue("");
        expect(next()).toBeDisabled();
    });

    it("stays open with the server's reason when the create is refused, and can try again", async () => {
        const user = userEvent.setup();
        createResult = () => Promise.reject({ code: "bad", message: "Kanal existiert schon" });
        const { onCreated } = await open({ sourceId: "e1" });
        await user.click(next());
        await user.click(next());
        await waitFor(() => expect(next()).toBeEnabled());
        await user.click(next());
        expect(currentStep()).toContain(stepLabel("check"));
        const create = screen.getByRole("button", { name: t("raidCreate.footer.create") });
        await user.click(create);
        expect(await screen.findByText("Kanal existiert schon")).toBeInTheDocument();
        expect(onCreated).not.toHaveBeenCalled();
        await waitFor(() => expect(create).toBeEnabled());
        createResult = () => Promise.resolve({ id: "new1" });
        await user.click(create);
        await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    });
});
