import "dotenv/config";
import { Client, GatewayIntentBits, Events, PermissionFlagsBits, MessageFlags } from "discord.js";
import { SYSTEM_PROMPT } from "./ai/prompts.js";
import { loadKnowledge, searchKnowledge, formatExcerpts } from "./knowledge/search.js";
import { registerCommands } from "./commands.js";
import { askAI, checkOllama } from "./ai/provider.js";
import { getSetting, setSetting, showSetting, describeAll, SETTING_NAMES } from "./settings.js";

for (const key of ["DISCORD_TOKEN"]) {
    if (!process.env[key]) throw new Error(`Missing environment variable: ${key} (check your .env file)`);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent // privileged: enable "Message Content Intent" in the Developer Portal
    ]
});
const lastUse = new Map();
const NO_PINGS = { parse: [] };

function splitMessage(text, max = 1900) {
    const chunks = [];
    let cur = "";
    const push = () => { if (cur) chunks.push(cur); cur = ""; };
    for (const line of text.split("\n")) {
        if (line.length > max) {
            push();
            for (let i = 0; i < line.length; i += max) chunks.push(line.slice(i, i + max));
        } else if ((cur + "\n" + line).length > max) {
            push();
            cur = line;
        } else {
            cur = cur ? cur + "\n" + line : line;
        }
    }
    push();
    return chunks;
}

/** Seconds the user still has to wait (0 = allowed, and the cooldown starts now). */
function cooldownLeft(userId) {
    const ms = getSetting("cooldown_seconds") * 1000;
    const wait = (lastUse.get(userId) || 0) + ms - Date.now();
    if (wait > 0) return Math.ceil(wait / 1000);
    lastUse.set(userId, Date.now());
    return 0;
}

async function generateAnswer(question) {
    const excerpts = formatExcerpts(searchKnowledge(question));
    const input = excerpts ? `${excerpts}\n\nQUESTION:\n${question}` : question;

    return askAI(input);
}

function errorHint(error) {
    const st = error?.status ?? error?.code;
    if (st === "OLLAMA_DOWN") return " (Ollama isn't running: start the Ollama app or run `ollama serve`)";
    if (st === "OLLAMA_TIMEOUT") return " (the local model took too long: try a smaller model or shorter question)";
    if (st === "GEMINI_API_KEY_MISSING") return ` (${error.message})`;
    if (error?.code === "OLLAMA_HTTP") {
        return error.status === 404
            ? " (Ollama model not found: run `ollama pull <model>` or use /settingchange ollama_model)"
            : ` (Ollama error ${error.status})`;
    }
    return st === 404 ? " (model not found: use /settingchange gemini_model)"
        : st === 400 || st === 401 || st === 403 ? ` (check ${geminiApiKeyEnvName}; the selected key may be invalid or lack API access)`
        : st === 429 ? " (Gemini rate limit/quota hit: switch with /settingchange provider ollama)"
        : st === 503 ? " (Gemini is overloaded, retry)" : "";
}

function geminiApiKeyEnvName() {
    const number = /^geminiapikey(\d+)$/i.exec(getSetting("gemini_api_key"))?.[1];
    return number ? `GEMINI_API_KEY${number}` : "GEMINI_API_KEY";
}

client.once(Events.ClientReady, async c => {
    console.log("--------------------------------");
    console.log("Pavlov Modkit AI is online!");
    console.log(`Logged in as ${c.user.tag}`);
    const prov = getSetting("provider");
    console.log(`AI: ${prov} (${getSetting(prov + "_model")}) | Knowledge chunks: ${loadKnowledge()}`);
    if (prov === "ollama") console.log(await checkOllama());
    const ch = getSetting("auto_reply_channel");
    console.log(`Auto-reply channel: ${ch || "off"}`);
    try {
        const where = await registerCommands(c.application.id);
        console.log(`Slash commands registered for ${where}.`);
    } catch (e) {
        console.error("Could not register slash commands:", e?.message || e);
    }
    console.log("--------------------------------");
});

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (!interaction.isChatInputCommand()) return;
        const ephemeral = { flags: MessageFlags.Ephemeral };

        if (interaction.commandName === "reload") {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: "You need Manage Server.", ...ephemeral });
            }
            return interaction.reply({ content: `Loaded ${loadKnowledge()} knowledge chunks.`, ...ephemeral });
        }

        if (interaction.commandName === "settingchange") {
            if (!interaction.guild || interaction.user.id !== interaction.guild.ownerId) {
                return interaction.reply({ content: "Only the server owner can change settings.", ...ephemeral });
            }
            const name = interaction.options.getString("setting", true);
            const raw = interaction.options.getString("value");
            if (!SETTING_NAMES.includes(name)) {
                return interaction.reply({ content: `Unknown setting. Options:\n\n${describeAll()}`, ...ephemeral });
            }
            if (raw === null) {
                return interaction.reply({ content: showSetting(name), ...ephemeral });
            }
            try {
                setSetting(name, raw);
                console.log(`Setting ${name} changed by ${interaction.user.tag}`);
                return interaction.reply({ content: `Updated.\n\n${showSetting(name)}`, ...ephemeral });
            } catch (e) {
                return interaction.reply({ content: `Not changed: ${e.message}\n\n${showSetting(name)}`, ...ephemeral });
            }
        }

        if (interaction.commandName === "rotateapikey") {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: "You need Administrator.", ...ephemeral });
            }
            await interaction.deferReply(ephemeral);
            try {
                const nextKeyName = rotateApiKey();
                console.log(`Gemini API key rotated by ${interaction.user.tag}`);
                return interaction.editReply(`Gemini API key rotated to ${nextKeyName}.`);
            } catch (e) {
                console.error("Could not rotate Gemini API key:", e?.message || e);
                return interaction.editReply(`Could not rotate Gemini API key: ${e.message}`);
            }
        }
        if (interaction.commandName === "help") {
            return interaction.reply({
                content: "Pavlov Modkit AI is a Discord bot that answers questions about Pavlov and Unreal Engine.\n\n" +
                    "Commands:\n" +
                    "/ask question:<your question> - Ask the AI assistant\n" +
                    "/reload - Reload the knowledge folder (Manage Server)\n" +
                    "/settingchange setting:<name> value:<new value> - View or change bot settings (Server owner only)\n" +
                    "/rotateapikey - Rotate the Gemini API key (Administrator only)\n" +
                    "/help - Show this help message\n\n" +
                    "Settings:\n" + describeAll(),
                ...ephemeral
            });
        }

        if (interaction.commandName !== "ask") return;

        const wait = cooldownLeft(interaction.user.id);
        if (wait > 0) {
            return interaction.reply({ content: `Please wait ${wait}s before asking again.`, ...ephemeral });
        }

        const question = interaction.options.getString("question", true);
        await interaction.deferReply();

        try {
            console.log(`Question from ${interaction.user.tag}: ${question}`);
            const parts = splitMessage(await generateAnswer(question));
            await interaction.editReply({ content: parts[0], allowedMentions: NO_PINGS });
            for (const p of parts.slice(1)) await interaction.followUp({ content: p, allowedMentions: NO_PINGS });
            console.log("Answered.");
        } catch (error) {
            console.error("AI error:", error?.status ?? error?.code, error?.message || error);
            await interaction.editReply(`I hit an error while answering${errorHint(error)}. Please try again later.`);
        }
    } catch (error) {
        console.error(`Interaction error (${interaction.commandName || "unknown"}) for ${interaction.user?.tag || "unknown user"}:`, error?.message || error);
    }
});
function rotateApiKey() {
    const currentKey = getSetting("gemini_api_key");
    const currentNumber = /^geminiapikey(\d+)$/i.exec(currentKey)?.[1];
    const availableKeys = Object.keys(process.env)
        .map(name => {
            const number = /^GEMINI_API_KEY(\d+)$/.exec(name)?.[1];
            return number && process.env[name]?.trim() ? { number: BigInt(number), name } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.number < b.number ? -1 : a.number > b.number ? 1 : 0);
    if (!availableKeys.length) {
        throw new Error("No numbered keys are configured. Add GEMINI_API_KEY1, GEMINI_API_KEY2, etc. to .env.");
    }
    const nextKey = availableKeys.find(key => currentNumber && key.number > BigInt(currentNumber)) || availableKeys[0];
    const nextNumber = nextKey.number;
    setSetting("gemini_api_key", `geminiapikey${nextNumber}`);
    return nextKey.name;
}
// Auto-reply: answers every human message in the configured channel.
client.on(Events.MessageCreate, async message => {
    if (message.author.bot || message.system || !message.guild) return;
    const channelId = getSetting("auto_reply_channel");
    if (!channelId || message.channelId !== channelId) return;

    const text = message.content?.trim();
    if (!text) return;

    if (cooldownLeft(message.author.id) > 0) {
        message.react("⏳").catch(() => {});
        return;
    }

    try {
        console.log(`Auto-reply question from ${message.author.tag}: ${text.slice(0, 200)}`);
        await message.channel.sendTyping().catch(() => {});
        const parts = splitMessage(await generateAnswer(text.slice(0, 1500)));
        await message.reply({ content: parts[0], allowedMentions: { parse: [], repliedUser: false } });
        for (const p of parts.slice(1)) await message.channel.send({ content: p, allowedMentions: NO_PINGS });
    } catch (error) {
        rotateApiKey();
        console.error("Rotating API KEY, Auto-reply AI error:", error?.status ?? error?.code, error?.message || error);
        message.reply({
            content: `I hit an error while answering${errorHint(error)}. Please try again later.`,
            allowedMentions: { parse: [], repliedUser: false }
        }).catch(() => {});
    }
});

process.on("unhandledRejection", e => console.error("Unhandled rejection:", e));

client.login(process.env.DISCORD_TOKEN).catch(e => {
    if (/disallowed intents/i.test(e?.message || "")) {
        console.error(
            "Login failed: Message Content Intent is off.\n" +
            "Developer Portal -> your app -> Bot -> Privileged Gateway Intents -> enable MESSAGE CONTENT INTENT -> Save, then restart."
        );
    } else {
        console.error("Login failed:", e?.message || e);
    }
    process.exit(1);
});
