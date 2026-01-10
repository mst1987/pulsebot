// API Configuration
const API_BASE_URL =
    process.env.API_BASE_URL || "https://pulse-gdkp.de:3001/api";

// Discord IDs
const legendaryID = "1144865420386517053";
const adminUserId = "233598324022837249";
const raidhelperBotId = "579155972115660803";
const categoryIds = [
    "1115368280245420042",
    "1143858079289577502",
    "1157813724741128293",
];
const highestBidsChannelId = "1145659881362313248";
const highestBidsMessageId = "1147062559036416191";

// Auction Settings
const maxBidAmount = 5000000;
const defaultTimeout = 60000;

module.exports = {
    API_BASE_URL,
    legendaryID,
    adminUserId,
    raidhelperBotId,
    categoryIds,
    highestBidsChannelId,
    highestBidsMessageId,
    maxBidAmount,
    defaultTimeout,
};