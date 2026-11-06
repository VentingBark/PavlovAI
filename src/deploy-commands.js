import { registerCommands } from "./commands.js";

// Optional: the bot now registers its commands automatically every time it starts,
// so you normally never need this. Run `npm run deploy` only to register without starting the bot.
try {
    console.log("Registering Discord commands...");
    const where = await registerCommands();
    console.log(`Successfully registered /ask, /reload and /settingchange for ${where}!`);
} catch (error) {
    console.error("Command registration failed:", error?.message || error);
    process.exitCode = 1;
}
