require("dotenv").config();
const { REST, Routes } = require("discord.js");
const rest = new REST({ version: "10" }).setToken(
  process.env.DISCORDJS_BOT_TOKEN,
);

(async () => {
  try {
    const commands = [
      {
        name: "mysetups",
        description: "Show the GDKP events i am in the Setup",
      },
      {
        name: "createoverview",
        description: "Creates an overview of the current category",
      },
      {
        name: "signup",
        description:
          "Sign Up to the raid in this channel with the specs/classes you want",
        options: [
          {
            name: "specs",
            description:
              // eslint-disable-next-line quotes
              'Sign up with these Specs - Seperate with "," (example: Combat,Assa,Affli,Demo,Fire,RestoDruid)',
            type: 3,
            required: true,
          },
        ],
      },
    ];
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID,
      ),
      { body: commands },
    );

    console.log("Slash events registered");
  } catch (error) {
    console.log("There was an error: " + error);
  }
})();
