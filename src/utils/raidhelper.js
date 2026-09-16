const { createRaidhelperClient } = require("./raidhelperClient");
const { getCategoryEvents, getCharacterIcon, delay } = require("./helper");

/**
 * The setup of an own EventHelper event in Raid-Helper's `{ setup: slots }`
 * shape, and only once it is approved (#263): a draft is never shown to
 * raiders, so an unapproved event reads exactly like one without a raidplan.
 */
function ownApprovedSetup(eventId) {
  // Required lazily: the web stores are only needed for own events.
  const { getEvent } = require("../web/eventStore");
  const { raidHelperSlots } = require("../web/setupEditor");
  const slots = raidHelperSlots(getEvent(eventId));
  return slots.length ? { setup: slots } : null;
}

/** A Raid-Helper raidplan, or undefined when Raid-Helper does not answer — one failing raid never costs the others (#291). */
async function safeSetup(raidhelper, eventId) {
  try {
    return await raidhelper.getSetup(eventId);
  } catch {
    return undefined;
  }
}

function isOwnEvent(event) {
  return !!event && (event.source === "eventhelper" || String(event.id || "").startsWith("eh-"));
}

async function getAllSignUps(interaction, categoryId) {
  var categoryEvents = await getCategoryEvents(interaction, categoryId);
  const noSignUps = getEventsWithoutSignup(categoryEvents, interaction);
  const signUps = getEventsWithSignup(categoryEvents, interaction);
  const response = {
    noSignUps: noSignUps.map((channel) => `<#${channel.channelId}>`).join("\n"),
    signUps: getSignUpsWithSpecs(signUps, interaction),
  };
  return response;
}

function getEventsWithoutSignup(events, interaction) {
  return events.filter(
    (event) =>
      !event.signUps.find(
        (signup) =>
          signup.userId === interaction.user.id && signup.specName !== "Absence"
      )
  );
}

function getEventsWithSignup(events, interaction) {
  return events.filter((event) =>
    event.signUps.find(
      (signup) =>
        signup.userId === interaction.user.id && signup.specName !== "Absence"
    )
  );
}

function getSignUpsWithSpecs(events, interaction) {
  const signUpsWithSpecs = events.map((event) => {
    const matchingSignUps = event.signUps.filter(
      (signUp) => signUp.userId === interaction.user.id
    );
    const matchingSpecs = matchingSignUps
      .map((signUp) => `${getCharacterIcon(interaction, signUp.specName)}`)
      .join("");
    return {
      specs: matchingSpecs,
      ...event,
    };
  });
  return signUpsWithSpecs
    .map((channelId) => `<#${channelId.channelId}>  ${channelId.specs}\n`)
    .join("\n");
}

async function getCategorySetups(interaction, categoryId) {
  let events = [];
  const raidhelper = createRaidhelperClient();
  var categoryEvents = await getCategoryEvents(interaction, categoryId);
  if (categoryEvents) {
    await Promise.all(
      categoryEvents.map(async (event) => {
        // An own EventHelper event has no Raid-Helper raidplan; its approved setup stands in.
        const setup = isOwnEvent(event) ? ownApprovedSetup(event.id) : await safeSetup(raidhelper, event.id);

        if (setup) {
          events.push({
            channelid: event.channelId,
            startTime: event.startTime,
            ...setup,
          });
        } else {
          events.push({
            channelid: event.channelId,
            startTime: event.startTime,
          });
        }
      })
    );

    events = events.filter((event, index) => {
      if (!event.setup) return event;
      else return event.setup.some((user) => user.id === interaction.user.id);
    });
  }
  return events;
}

async function getSetupsFromEvents(client, interaction, events) {
  let myevents = [];
  const raidhelper = createRaidhelperClient();
  await Promise.all(
    events.map(async (event) => {
      const setup = isOwnEvent(event) ? ownApprovedSetup(event.id) : await safeSetup(raidhelper, event.id);
      if (setup) {
        myevents.push({
          channelid: event.channelId,
          startTime: event.startTime,
          ...setup,
        });
      }
    })
  );

  myevents = myevents.filter((event, index) => {
    if (event.setup)
      return event.setup.some((user) => user.id === interaction.user.id);
  });
  return myevents;
}

module.exports = {
  getAllSignUps,
  getCategorySetups,
  getSetupsFromEvents,
  ownApprovedSetup,
};
