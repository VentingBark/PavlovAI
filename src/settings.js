import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
const FILE = path.join(DIR, "settings.json");

export const DEFAULT_MODEL = "gemini-3-flash-preview";
export const DEFAULT_OLLAMA_MODEL = "llama3.1:8b";

function parseModel(raw) {
    const v = raw.trim();
    if (!/^[\w.\-:/]{2,80}$/.test(v)) throw new Error("That doesn't look like a model name.");
    return v;
}

const DEFS = {
    auto_reply_channel: {
        help: "Channel ID (or #mention) where the bot answers every human message. Use 'off' to disable.",
        default: () => (process.env.AUTO_REPLY_CHANNEL_ID || "").trim(),
        parse(raw) {
            const v = raw.trim().toLowerCase();
            if (["", "off", "none", "disable", "disabled", "0"].includes(v)) return "";
            const m = raw.match(/\d{17,20}/);
            if (!m) throw new Error("Give a channel ID or #mention, or 'off'.");
            return m[0];
        },
        show: v => (v ? `<#${v}> (${v})` : "off")
    },
    cooldown_seconds: {
        help: "Seconds each user must wait between questions (0 to 3600).",
        default: () => 10,
        parse(raw) {
            const n = Number(raw.trim());
            if (!Number.isInteger(n) || n < 0 || n > 3600) throw new Error("Give a whole number from 0 to 3600.");
            return n;
        },
        show: v => `${v}s`
    },
    provider: {
        help: "Which AI runs the answers: ollama (local, free) or gemini.",
        default: () => ((process.env.AI_PROVIDER || "ollama").trim().toLowerCase() === "gemini" ? "gemini" : "ollama"),
        parse(raw) {
            const v = raw.trim().toLowerCase();
            if (v !== "ollama" && v !== "gemini") throw new Error("Use 'ollama' or 'gemini'.");
            return v;
        },
        show: v => `\`${v}\``
    },
    ollama_model: {
        help: "Ollama model name exactly as shown by `ollama list`, e.g. llama3.1:8b. Must be pulled first.",
        default: () => (process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL).trim(),
        parse: parseModel,
        show: v => `\`${v}\``
    },
    gemini_model: {
        help: "Gemini model ID, e.g. gemini-3-flash-preview or gemini-2.5-flash.",
        default: () => (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim(),
        parse: parseModel,
        show: v => `\`${v}\``
    },
    gemini_api_key: {
        help: "Gemini API key. Defaults to GEMINI_API_KEY from .env.",
        default: () => (process.env.GEMINI_API_KEY || "").trim(),
        parse(raw) {
            const value = raw.trim();
            if (!value) throw new Error("Give a Gemini API key.");
            return value;
        },
        show: v => (v ? "`(set)`" : "`(not set)`")
    }
};

export const SETTING_NAMES = Object.keys(DEFS);

let store = {};
try {
    store = JSON.parse(fs.readFileSync(FILE, "utf8")) || {};
} catch {
    store = {};
}

export function getSetting(name) {
    return store[name] !== undefined ? store[name] : DEFS[name].default();
}

export function showSetting(name) {
    return `**${name}**: ${DEFS[name].show(getSetting(name))}\n${DEFS[name].help}`;
}

export function setSetting(name, raw) {
    const def = DEFS[name];
    if (!def) throw new Error("Unknown setting.");
    const value = def.parse(raw);
    store[name] = value;
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
    return value;
}

export function describeAll() {
    return SETTING_NAMES.map(showSetting).join("\n\n");
}
