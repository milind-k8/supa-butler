import axios from "axios";

const CHAT_JIMMY_URL = "https://chatjimmy.ai/api/chat";
const DEFAULT_MODEL = "llama3.1-8B";

export const customFetch = async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  // 1. Resolve URL from supported fetch input types.
  const url = input instanceof Request ? input.url : input.toString();

  if (!init?.body) {
    throw new Error(`No body in request for ${url}`);
  }

  // 2. Parse payload from Anthropic SDK request.
  const sdkBody = JSON.parse(init.body as string) as {
    messages?: unknown[];
    max_tokens?: number;
  };

  // 3. Map Anthropic SDK payload to ChatJimmy format.
  const chatJimmyPayload = {
    messages: sdkBody.messages ?? [],
    chatOptions: {
      selectedModel: DEFAULT_MODEL,
      topK: 8,
      maxTokens: sdkBody.max_tokens ?? 1024,
    },
  };

  // 4. Call ChatJimmy endpoint.
  const response = await axios.post(CHAT_JIMMY_URL, chatJimmyPayload, {
    headers: {
      accept: "*/*",
      "content-type": "application/json",
      origin: "https://chatjimmy.ai",
      referer: "https://chatjimmy.ai/",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    responseType: "text",
    timeout: 30000,
  });

  // 5. Strip metadata block from the upstream response.
  const cleanedText = String(response.data)
    .replace(/<\|stats\|>[\s\S]*?<\|\/stats\|>/g, "")
    .trim();

  // 6. Return Anthropic-compatible message response.
  const mockResponse = {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: cleanedText }],
    model: DEFAULT_MODEL,
    stop_reason: "end_turn",
    usage: { input_tokens: 0, output_tokens: 0 },
  };

  return new Response(JSON.stringify(mockResponse), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export { DEFAULT_MODEL };
