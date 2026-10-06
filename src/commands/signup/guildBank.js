// The orga's buttons under a guild bank request in the orga channel
// (services/signups/guildBank.js, built by utils/signup/guildBankPost.js):
//
//   guildbank:done:<id>      "Erledigt" (free-text request) — resolves at once, the raider gets a DM
//   guildbank:confirm:<id>   "Bestätigen" (request from the stock) — sets the amount aside after
//                            checking "Verfügbar" again, the raider gets a DM
//   guildbank:handout:<id>   "Ausgegeben" — a confirmed request was handed out in game, DM
//   guildbank:release:<id>   "Vormerkung lösen" — a confirmed request is open again, no DM
//   guildbank:reject:<id>    "Ablehnen …" — opens the decline modal
//   guildbank:mreject:<id>   the submitted decline modal (optional reason)
//
// Only the orga with write access to `raids` may — the same rights model as
// the web menu (config/permissions.js), resolved by services/discord/userAccess.js
// from the member's roles on the event servers. The bot gate (botAccess.js)
// lets every click through (`defaultAccess: "everyone"`): the channel is the
// orga's, and the real check is the area right below, not a role list of its
// own. Every answer is ephemeral and German (orga text).
const { MessageFlags } = require("discord.js");
const { card } = require("../../utils/discord/card");
const store = require("../../stores/guildBankStore");
const guildBank = require("../../services/signups/guildBank");
const { userMayAny } = require("../../services/discord/userAccess");
const { PREFIX, parseOrgaId, rejectModal, plain } = require("../../utils/signup/guildBankPost");

const NO_RIGHTS = "Das darf nur die Orga mit Raid-Rechten.";
const GONE = "Diese Anfrage gibt es nicht mehr.";
const HANDLED = "Diese Anfrage ist schon erledigt.";
const ACTIONS = ["done", "reject", "mreject", "confirm", "handout", "release"];

/** The clicking member's name as the orga reads it. */
function displayName(interaction) {
    const member = interaction.member;
    const user = interaction.user || {};
    return String((member && (member.displayName || member.nick)) || user.globalName || user.username || "").trim();
}

const mayHandle = (interaction) => userMayAny(interaction.user.id, ["raids"], "write");

/** The DM line of an answer. */
function dmLine(result) {
    const name = plain(result.request.userName);
    return result.dm ? `${name || "Der Raider"} bekommt eine DM.` : `Die DM an ${name || "den Raider"} kam nicht an – sind die DMs zu?`;
}

const TITLES = { done: "Erledigt", rejected: "Abgelehnt", confirmed: "Vorgemerkt", handedOut: "Ausgegeben", open: "Vormerkung gelöst" };

/** What the orga reads after handling a request, as a card; `dm` = whether the step sends one. */
function doneCard(result, dm) {
    const r = result.request;
    const ok = r.status !== "rejected" && (!dm || result.dm);
    return card({
        kind: ok ? "ok" : "warn",
        title: TITLES[r.status] || "Erledigt",
        text: dm ? dmLine(result) : "",
        note: result.posted ? "" : "Der Post im Kanal ließ sich nicht aktualisieren.",
    });
}

/** A refused step: gone, handled before, or not enough left. */
function refusedCard(result) {
    if (!result.request) return card({ kind: "warn", title: GONE });
    if (result.available !== undefined) return card({ kind: "warn", title: "Nicht genug verfügbar", text: result.error });
    return card({ kind: "warn", title: result.error });
}

/** Run a step of the service and say how it went (the reply is already deferred). */
async function run(interaction, step, { dm = true } = {}) {
    const result = await step();
    if (result.error) return interaction.editReply(refusedCard(result));
    return interaction.editReply(doneCard(result, dm));
}

module.exports = {
    name: PREFIX,
    description: "Knöpfe unter einer Gildenbank-Anfrage im Orga-Kanal (Bestätigen, Ausgegeben, Vormerkung lösen, Erledigt, Ablehnen)",
    group: "signup",
    defaultAccess: "everyone",
    async execute(interaction) {
        const { action, id } = parseOrgaId(interaction.customId);
        const ephemeral = (title, kind = "error") => interaction.reply(card({ kind, title, ephemeral: true }));
        if (!id || !ACTIONS.includes(action)) return ephemeral("Unbekannte Aktion.");
        if (action === "reject") {
            // the modal must be the first answer — check before opening it
            if (!(await mayHandle(interaction))) return ephemeral(NO_RIGHTS);
            const request = store.getRequest(id);
            if (!request) return ephemeral(GONE, "warn");
            if (request.status !== "open") {
                // answer first (three seconds), then take the stale buttons off the post
                await ephemeral(HANDLED, "warn");
                return guildBank.redrawPost(request);
            }
            return interaction.showModal(rejectModal(id));
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!(await mayHandle(interaction))) return interaction.editReply(card({ kind: "error", title: NO_RIGHTS }));
        const by = { by: interaction.user.id, byName: displayName(interaction) };
        if (action === "done") return run(interaction, () => guildBank.resolveRequest(id, { ...by, status: "done", reason: "" }));
        if (action === "confirm") return run(interaction, () => guildBank.confirmRequest(id, by));
        if (action === "handout") return run(interaction, () => guildBank.handOutRequest(id, { ...by, via: "discord" }));
        if (action === "release") return run(interaction, () => guildBank.releaseRequest(id), { dm: false });
        let reason = "";
        try {
            reason = String(interaction.fields.getTextInputValue("reason") || "").trim();
        } catch {
            // no reason field: declined without one
        }
        return run(interaction, () => guildBank.resolveRequest(id, { ...by, status: "rejected", reason }));
    },
};
