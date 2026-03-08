import Anthropic from "@anthropic-ai/sdk";

import { customFetch } from "../model/custom-fetch.js";

export const anthropic = new Anthropic({
  apiKey: "not-needed-for-custom-fetch",
  fetch: customFetch,
});
