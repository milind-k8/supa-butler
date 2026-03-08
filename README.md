# supa-butler

Supa Butler now includes a ChatGPT-style dark web chat interface and an API route that forwards prompts to the existing agent/model bridge.

## What it does

- Uses the Anthropic SDK with the project `customFetch` bridge.
- Sends requests to `https://chatjimmy.ai/api/chat`.
- Exposes `POST /api/agent` for chat messages.
- Serves a black themed chat UI at `/`.

## Run CLI

```bash
npm install
npm run dev -- "Write a haiku about agents"
```

## Run web chat

```bash
npm run dev:web
```

Then open `http://localhost:3000`.
