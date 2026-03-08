import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { createMessage } from "./index.js";

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = join(process.cwd(), "public");

interface ChatRequestBody {
  message?: string;
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const sendJson = (res: ServerResponse, statusCode: number, data: unknown): void => {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};

const readJsonBody = async (req: IncomingMessage): Promise<ChatRequestBody> => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as ChatRequestBody;
};

const extractTextFromResponse = (response: Awaited<ReturnType<typeof createMessage>>): string => {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
};

const serveStatic = async (pathname: string, res: ServerResponse): Promise<void> => {
  const fileName = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = join(PUBLIC_DIR, fileName);
  const extension = extname(filePath).toLowerCase();

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypes[extension] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: "Not Found" });
  }
};

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (method === "POST" && url.pathname === "/api/agent") {
    try {
      const body = await readJsonBody(req);
      const message = body.message?.trim();

      if (!message) {
        sendJson(res, 400, { error: "Message is required." });
        return;
      }

      const modelResponse = await createMessage(message);
      sendJson(res, 200, { reply: extractTextFromResponse(modelResponse) });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error.";
      sendJson(res, 500, { error: message });
      return;
    }
  }

  if (method === "GET") {
    await serveStatic(url.pathname, res);
    return;
  }

  sendJson(res, 405, { error: "Method Not Allowed" });
});

server.listen(PORT, HOST, () => {
  console.log(`Chat UI running at http://${HOST}:${PORT}`);
});
