import "dotenv/config";
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { SETTING_NAMES } from "./settings.js";

export const commands = [
    new SlashCommandBuilder()
        .setName("ask")
        .setDescription("Ask the Pavlov Modkit AI assistant")
        .addStringOption(o =>
            o.setName("question").setDescription("Your Pavlov or Unreal Engine question")
                .setRequired(true).setMaxLength(1500)),
    new SlashCommandBuilder()
        .setName("reload")
        .setDescription("Reload the knowledge folder (Manage Server)")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
        .setName("settingchange")
        .setDescription("Server owner only: view or change bot settings while it runs")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addStringOption(o =>
            o.setName("setting").setDescription("Which setting")
                .setRequired(true)
                .addChoices(...SETTING_NAMES.map(n => ({ name: n, value: n }))))
        .addStringOption(o =>
            o.setName("value").setDescription("New value (leave empty to just view the current value)")
                .setMaxLength(100)),
    new SlashCommandBuilder()
        .setName("rotateapikey")
        .setDescription("Rotate the API key")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName("help")
        .setDescription("Show help for the bot and its commands")
].map(c => c.toJSON());

const isId = v => /^\d{17,20}$/.test((v || "").trim());

/** Registers slash commands. clientIdFallback = the logged-in bot's application ID. */
export async function registerCommands(clientIdFallback) {
    const token = process.env.DISCORD_TOKEN;
    if (!token) throw new Error("Missing environment variable: DISCORD_TOKEN (check your .env file)");

    const envId = (process.env.DISCORD_CLIENT_ID || "").trim();
    const clientId = isId(envId) ? envId : clientIdFallback;
    if (!clientId) throw new Error("Missing or invalid DISCORD_CLIENT_ID in .env");

    const guildId = (process.env.DISCORD_GUILD_ID || "").trim();
    const rest = new REST({ version: "10" }).setToken(token);

    if (isId(guildId)) {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        return "your server (instant)";
    }
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    return "all servers (global, can take up to an hour)";
}
