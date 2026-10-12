// The orga's buttons under a guild bank request in the orga channel
// (services/signups/guildBank.js, built by utils/signup/guildBankPost.js):
//
//   guildbank:done:<id>      "Erledigt" (free-text request) — resolves at once, the raider gets a DM
//   guildbank:confirm:<id>   "Bestätigen" (request from the stock) — sets the amount aside after
//                            checking "Verfügbar" again, the raider gets a DM; only with a linked
//                            character (services/guildbank/linking.js), else "Erst einen Charakter
//                            verknüpfen – im Web unter Gildenbank."
//   guildbank:vouch:<id>     "Geprüft & bestätigen" — instead of "Bestätigen" while the request is not
//                            linked but names a character: the clicking member vouches for the name
//                            (checked in game) and the request is confirmed (#806)
//   guildbank:handout:<id>   "Ausgegeben" — a confirmed request was handed out in game, DM
//   guildbank:release:<id>   "Vormerkung lösen" — a confirmed request is open again, no DM
//   guildbank:rename:<id>    "Charakter ändern …" (#809) — opens the modal with name and realm
//   guildbank:mrename:<id>   the submitted modal: the request goes to that name (the orga vouches)
//   guildbank:reject:<id>    "Ablehnen …" — opens the decline modal
//   guildbank:mreject:<id>   the submitted decline modal (optional reason)
//
// Declining a request from the stock and releasing a confirmation move the
// item's waiting list up (services/signups/guildBank.advanceWaitlist, #775).
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
const { PREFIX, parseOrgaId, rejectModal, renameModal, plain, recipientName } = require("../../utils/signup/guildBankPost");

const NO_RIGHTS = "Das darf nur die Orga mit Raid-Rechten.";
const GONE = "Diese Anfrage gibt es nicht mehr.";
const HANDLED = "Diese Anfrage ist schon erledigt.";
const ACTIONS = ["done", "reject", "mreject", "confirm", "vouch", "handout", "release", "rename", "mrename"];

/** The clicking member's name as the orga reads it. */
function displayName(interaction) {
    const member = interaction.member;
    const user = interaction.user || {};
    return String((member && (member.displayName || member.nick)) || user.globalName || user.username || "").trim();
}

const mayHandle = (interaction) => userMayAny(interaction.user.id, ["raids"], "write");

/** The DM line of an answer. */
function dmLine(result) {
    // a waiting-list entry imported by character name alone (#775)
    if (result.request.userId === "" && result.request.characterName) return `${plain(result.request.characterName) || "Der Eintrag"} hat kein Discord-Konto – keine DM.`;
    const name = plain(result.request.userName);
    return result.dm ? `${name || "Der Raider"} bekommt eine DM.` : `Die DM an ${name || "den Raider"} kam nicht an – sind die DMs zu?`;
}

const TITLES = { done: "Erledigt", rejected: "Abgelehnt", confirmed: "Vorgemerkt", handedOut: "Ausgegeben", open: "Vormerkung gelöst" };

/** What the orga reads after handling a request, as a card; `dm` = whether the step sends one. */
function doneCard(result, dm) {
    const r = result.request;
    const ok = r.status !== "rejected" && (!dm || result.dm || r.userId === "");
    return card({
        kind: ok ? "ok" : "warn",
        title: TITLES[r.status] || "Erledigt",
        text: dm ? dmLine(result) : "",
        note: result.posted ? "" : "Der Post im Kanal ließ sich nicht aktualisieren.",
    });
}

/** A refused step: gone, handled before, no linked character, or not enough left. */
function refusedCard(result) {
    if (!result.request) return card({ kind: "warn", title: GONE });
    // the addon would mail to a name nobody plays: the orga links a profile character first
    // a profile character nobody confirmed (typed at a signup) — check it in the web first
    if (result.notLinked && result.linkProblem === "unverified") return card({ kind: "warn", title: "Charakter nicht bestätigt", text: result.error });
    if (result.notLinked) return card({ kind: "warn", title: "Kein verknüpfter Charakter", text: result.error });
    if (result.available !== undefined) return card({ kind: "warn", title: "Nicht genug verfügbar", text: result.error });
    return card({ kind: "warn", title: result.error });
}

/** A text field of a submitted modal, "" when it is missing. */
function fieldOf(interaction, id) {
    try {
        return String(interaction.fields.getTextInputValue(id) || "").trim();
    } catch {
        return "";
    }
}

/**
 * The submitted "Charakter ändern …" (#809): the request goes to that name —
 * the orga vouches for it with the submit (the modal says: checked in game).
 */
async function rename(interaction, id, by) {
    const result = await guildBank.reassignRequest(id, { ...by, characterName: fieldOf(interaction, "name"), realm: fieldOf(interaction, "realm"), checked: true });
    if (result.error) return interaction.editReply(card({ kind: "warn", title: "Empfänger nicht geändert", text: result.error }));
    return interaction.editReply(card({ kind: "ok", title: "Empfänger geändert", text: `Geht jetzt an ${plain(recipientName(result.request))}.` }));
}

/** Run a step of the service and say how it went (the reply is already deferred). */async function run(interaction, step, { dm = true } = {}) {
    const result = await step();
    if (result.error) return interaction.editReply(refusedCard(result));
    return interaction.editReply(doneCard(result, dm));
}

module.exports = {
    name: PREFIX,
    description: "Knöpfe unter einer Gildenbank-Anfrage im Orga-Kanal (Bestätigen, Ausgegeben, Vormerkung lösen, Charakter ändern, Erledigt, Ablehnen)",
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
        if (action === "rename") {
            // the modal must be the first answer — check before opening it (#809)
            if (!(await mayHandle(interaction))) return ephemeral(NO_RIGHTS);
            const request = store.getRequest(id);
            if (!request) return ephemeral(GONE, "warn");
            if (!["open", "confirmed"].includes(request.status)) {
                await ephemeral(HANDLED, "warn");
                return guildBank.redrawPost(request);
            }
            return interaction.showModal(renameModal(request));
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!(await mayHandle(interaction))) return interaction.editReply(card({ kind: "error", title: NO_RIGHTS }));
        const by = { by: interaction.user.id, byName: displayName(interaction) };
        if (action === "done") return run(interaction, () => guildBank.resolveRequest(id, { ...by, status: "done", reason: "" }));
        if (action === "confirm") return run(interaction, () => guildBank.confirmRequest(id, by));
        // the orga checked the name in game: it vouches for the recipient and confirms (#806)
        if (action === "vouch") return run(interaction, () => guildBank.checkAndConfirm(id, by));
        if (action === "handout") return run(interaction, () => guildBank.handOutRequest(id, { ...by, via: "discord" }));
        if (action === "release") return run(interaction, () => guildBank.releaseRequest(id), { dm: false });
        if (action === "mrename") return rename(interaction, id, by);
        // no reason field: declined without one
        return run(interaction, () => guildBank.resolveRequest(id, { ...by, status: "rejected", reason: fieldOf(interaction, "reason") }));
    },
};
