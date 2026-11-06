import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../knowledge");
const STOP = new Set("the a an and or of to in on for is are was it this that with how do i can my what why when you your be as at by from not but if so".split(" "));

let chunks = [];

const tokenize = s => (s.toLowerCase().match(/[a-z0-9_]{2,}/g) || []).filter(t => !STOP.has(t));

function walk(dir) {
    let out = [];
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out = out.concat(walk(p));
        else if (/\.(md|txt)$/i.test(e.name) && !e.name.startsWith("_")) out.push(p);
    }
    return out;
}

export function loadKnowledge() {
    chunks = [];
    for (const file of walk(ROOT)) {
        // A file may hold several entries separated by a line of ===== (3+ equals signs).
        const sections = fs.readFileSync(file, "utf8").split(/^[ \t]*={3,}[ \t]*$/m);
        for (const section of sections) {
            const lines = section.split(/\r?\n/);
            while (lines.length && !lines[0].trim()) lines.shift();
            let title = path.relative(ROOT, file);
            let source = "";
            while (lines.length && /^(title|source):/i.test(lines[0])) {
                const l = lines.shift();
                if (/^title:/i.test(l)) title = l.replace(/^title:\s*/i, "").trim();
                else source = l.replace(/^source:\s*/i, "").trim();
            }
            let buf = "";
            const flush = () => {
                if (buf.trim()) chunks.push({ title, source, text: buf.trim(), tokens: new Set(tokenize(title + " " + buf)) });
                buf = "";
            };
            for (const para of lines.join("\n").split(/\n\s*\n/)) {
                if ((buf + para).length > 1200) flush();
                buf += para + "\n\n";
            }
            flush();
        }
    }
    return chunks.length;
}

export function searchKnowledge(query, limit = 4) {
    const q = tokenize(query);
    if (!q.length || !chunks.length) return [];
    return chunks
        .map(c => ({ c, score: q.reduce((s, t) => s + (c.tokens.has(t) ? 1 : 0), 0) / Math.sqrt(q.length) }))
        .filter(x => x.score >= 1)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(x => x.c);
}

export function formatExcerpts(found) {
    if (!found.length) return "";
    return "KNOWLEDGE BASE EXCERPTS:\n\n" +
        found.map((c, i) => `[${i + 1}] ${c.title}${c.source ? " (" + c.source + ")" : ""}\n${c.text}`).join("\n\n---\n\n");
}
