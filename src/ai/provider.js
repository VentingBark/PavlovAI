import { SYSTEM_PROMPT } from "./prompts.js";
import { getSetting } from "../settings.js";

const host = () => (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/+$/, "");
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

// Local models handle one request at a time best, so Ollama calls run in a queue.
let chain = Promise.resolve();
function enqueue(fn) {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
}

async function askOllama(input) {
    const model = getSetting("ollama_model");
    let res;
    try {
        res = await fetch(`${host()}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                stream: false,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: input }
                ],
                options: {
                    num_ctx: num(process.env.OLLAMA_NUM_CTX, 8192),
                    num_predict: num(process.env.OLLAMA_NUM_PREDICT, 1200),
                    temperature: 0.3
                }
            }),
            signal: AbortSignal.timeout(num(process.env.OLLAMA_TIMEOUT_MS, 180000))
        });
    } catch (e) {
        if (e?.name === "TimeoutError") throw Object.assign(new Error("Ollama timed out"), { code: "OLLAMA_TIMEOUT" });
        throw Object.assign(new Error(`Cannot reach Ollama at ${host()}: ${e?.cause?.code || e?.message}`), { code: "OLLAMA_DOWN" });
    }
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw Object.assign(new Error(text.slice(0, 300) || res.statusText), { status: res.status, code: "OLLAMA_HTTP" });
    }
    const data = await res.json();
    // Some reasoning models put <think>...</think> in the text; hide it.
    return (data?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

let gemini = null;
let geminiApiKey = null;
async function askGemini(input) {
    const selectedKey = getSetting("gemini_api_key");
    const selectedNumber = /^geminiapikey(\d+)$/i.exec(selectedKey)?.[1];
    const keyName = selectedNumber ? `GEMINI_API_KEY${selectedNumber}` : "GEMINI_API_KEY";
    const apiKey = selectedNumber ? process.env[keyName]?.trim() : selectedKey;
    if (!apiKey) throw Object.assign(new Error(`${keyName} is not set in .env.`), { code: "GEMINI_API_KEY_MISSING" });
    if (!gemini || geminiApiKey !== apiKey) {
        const { GoogleGenAI } = await import("@google/genai");
        gemini = new GoogleGenAI({ apiKey });
        geminiApiKey = apiKey;
    }
    const response = await gemini.models.generateContent({
        model: getSetting("gemini_model"),
        contents: input,
        config: { systemInstruction: SYSTEM_PROMPT, maxOutputTokens: 4000 }
    });
    return response.text?.trim() || "";
}

export async function askAI(input) {
    const answer = getSetting("provider") === "gemini" ? await askGemini(input) : await enqueue(() => askOllama(input));
    if (!answer) throw new Error("The AI returned an empty response (possibly blocked or cut off).");
    return answer;
}

/** Startup diagnostic for Ollama. Returns a human-readable status line. */
export async function checkOllama() {
    try {
        const res = await fetch(`${host()}/api/tags`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) return `Ollama answered with HTTP ${res.status}.`;
        const names = ((await res.json()).models || []).map(m => m.name);
        const want = getSetting("ollama_model");
        const found = names.some(n => n === want || n === `${want}:latest` || n.replace(/:latest$/, "") === want);
        return found
            ? `Ollama OK, model "${want}" is installed.`
            : `Ollama is running but model "${want}" is NOT installed. Run: ollama pull ${want}   (installed: ${names.join(", ") || "none"})`;
    } catch {
        return `Cannot reach Ollama at ${host()}. Start the Ollama app (or run "ollama serve").`;
    }
}
