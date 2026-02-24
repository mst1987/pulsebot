const { getCharacterIcon, findServerEmoji } = require("./helper.js");
const {
  formatTimestampToDateString,
  parseDMYDateString,
} = require("./date.js");

function setupResponse(interaction, event) {
  let notInSetup = "Setup not done yet";
  let emoji = "copium";
  let inSetup = false;
  if (event.setup) {
    notInSetup = "Not in Setup";
    emoji = "sadcat";
    inSetup = event.setup.find((signUp) => {
      return signUp.id === interaction.user.id;
    });
  }

  console.log(inSetup);

  let spec;
  if (inSetup) spec = inSetup.spec;
  return `<#${event.channelid}> <t:${Math.round(
    Number(event.startTime)
  )}:R> \n ${
    spec
      ? getCharacterIcon(interaction, spec)
      : findServerEmoji(interaction, emoji)
  } **${
    spec ? extendedClassList[spec].name : notInSetup
  }**\n${formatTimestampToDateString(event.startTime * 1000)} Uhr\n`;
}

function mySetupResponse(interaction, events) {
  // Filter Setups, sort it and only get User data
  const setupData = events
    .filter((event, index) => {
      return event.setup.some((user) => user.userid === interaction.user.id);
    })
    .sort((eventA, eventB) => eventA.startTime - eventB.startTime)
    .map((slot) => ({
      ...slot,
      setup: slot.setup.filter((user) => user.userid === interaction.user.id),
    }));

  // Format Signup and get Discord Emojis for the classes
  return setupData
    .map(
      (channel) =>
        `<#${channel.channelid}> ${getCharacterIcon(
          interaction,
          channel.setup[0].spec
        )} ${
          extendedClassList[channel.setup[0].spec].name
        }\n${formatTimestampToDateString(channel.startTime * 1000)} Uhr\n`
    )
    .join("\n");
}

function getAuctionMessage(interaction, legendary) {
  return `**${legendary.name}**\n\nRaid: **${
    legendary.raid
  }**\nAuktion endet am **${formatTimestampToDateString(
    Number(legendary.endtime)
  )}**\n\nStartpreis ist **${
    legendary.mingold
  }g** und Mindesterhöhung liegt bei **${
    legendary.increment
  }g**\n\nBenutze den **/bid** Befehl um mitzubieten!\n\nExample:\`\`\`/bid gold:350000\`\`\``;
}

function getItemsToShow(interaction, items, dateFrom, dateEnd) {
  const filteredItems = items
    .filter((entry) => {
      const entryDate = parseDMYDateString(entry.date);
      return entryDate >= dateFrom && entryDate <= dateEnd;
    })
    .sort((a, b) => a.player.localeCompare(b.player));

  const formattedItems = getItemsFormatted(interaction, filteredItems);
  const sumOfGold = filteredItems.reduce(
    (totalGold, entry) => totalGold + entry.gold,
    0
  );
  return `${formattedItems}\n\n\nGesamtausgaben: **${sumOfGold}g**`;
}

function getItemsFormatted(interaction, items) {
  return items
    .map(
      (item) =>
        `${getCharacterIcon(interaction, item.class)} ${item.player} - [${
          item.item
        }](${item.wowhead}) - ${item.gold}g`
    )
    .join("\n");
}

module.exports = {
  getItemsFormatted,
  getItemsToShow,
  getAuctionMessage,
  mySetupResponse,
  setupResponse,
};
