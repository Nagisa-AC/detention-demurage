import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { pageLine, systemPrompt } from "./prompt.js";
import { providerSchema } from "./provider-schema.js";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export const DEFAULT_EFFORT = "low";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const EFFORTS = new Set<string>(["low", "medium", "high", "xhigh", "max"]);

export function isEffort(value: string): value is Effort {
  return EFFORTS.has(value);
}

/** The Messages request for one page. It does not send the request. */
export function buildAnthropicRequest(input: {
  model: string;
  effort: Effort;
  pageNumber: number;
  pdf: Uint8Array;
  retry: { previous: string; errors: string } | null;
}): MessageCreateParamsNonStreaming {
  return {
    model: input.model,
    stream: false,
    max_tokens: 8192,
    inference_geo: "us",
    system: systemPrompt(),
    output_config: {
      effort: input.effort,
      format: {
        type: "json_schema",
        schema: providerSchema(),
      },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: Buffer.from(input.pdf).toString("base64"),
            },
          },
          { type: "text", text: pageLine(input.pageNumber, input.retry) },
        ],
      },
    ],
  };
}
