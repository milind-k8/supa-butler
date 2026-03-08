# supa-butler

This project now uses a custom `fetch` bridge as the default model transport for Anthropic SDK calls.

## Default model behavior

- Anthropic SDK is initialized with `fetch: customFetch`.
- Requests are mapped to `https://chatjimmy.ai/api/chat`.
- Default selected model is `llama3.1-8B`.

## Run

```bash
npm install
npm run dev -- "Write a haiku about agents"
```
