import Anthropic from "@anthropic-ai/sdk";
import type { Message, MessageCreateParamsNonStreaming, Usage as ApiUsage } from "@anthropic-ai/sdk/resources/messages/messages";
import { type Usage } from "./cost.js";

export type ModelResponse = {
  text: string;
  stopReason: string;
  usage: Usage;
  inferenceGeo: string | null;
};

export async function readAnthropicPage(request: MessageCreateParamsNonStreaming, apiKey: string): Promise<ModelResponse> {
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create(request);
  return {
    text: textOf(message),
    stopReason: message.stop_reason ?? "",
    usage: usageOf(message.usage),
    inferenceGeo: message.usage.inference_geo,
  };
}

function textOf(message: Message): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function usageOf(usage: ApiUsage): Usage {
  const cache = usage.cache_creation;
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_5m_tokens: cache === null ? (usage.cache_creation_input_tokens ?? 0) : cache.ephemeral_5m_input_tokens,
    cache_1h_tokens: cache === null ? 0 : cache.ephemeral_1h_input_tokens,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
  };
}
