# Pavlov Modkit AI (Ollama or Gemini)

1. Node 18.17+ (24 LTS recommended).
2. Install Ollama (ollama.com), then in PowerShell: `ollama pull llama3.1:8b` (any model works; `ollama list` shows names).
3. Copy `.env.example` to `.env`, fill DISCORD_TOKEN, and set OLLAMA_MODEL to a model you pulled.
4. Developer Portal -> Bot -> Privileged Gateway Intents -> enable MESSAGE CONTENT INTENT (needed for auto-reply).
5. `npm install`
6. `npm start` (slash commands register automatically; the Ollama app must be running)

## Commands
- `/ask question`
- `/reload` reload knowledge folder (Manage Server)
- `/settingchange setting [value]` server owner only, live + saved to `data/settings.json`. Settings: auto_reply_channel, cooldown_seconds, provider (ollama|gemini), ollama_model, gemini_model. Omit value to view.

Local models are slower and weaker than cloud ones; bigger model = better answers but more RAM/VRAM. Requests are queued one at a time.
Add docs as .md/.txt under `knowledge/`, then `/reload`. Never share `.env`.
