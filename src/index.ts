import { anthropic } from "./core/anthropic-client.js";
import { DEFAULT_MODEL } from "./model/custom-fetch.js";

export const createMessage = async (prompt: string) => {
  return anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
};

if (process.argv[2]) {
  const prompt = process.argv.slice(2).join(" ");
  const response = await createMessage(prompt);
  console.log(JSON.stringify(response, null, 2));
}
