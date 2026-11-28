import type Anthropic from "@anthropic-ai/sdk";

/** Joined text of a Claude reply's text blocks, trimmed (tool_use etc. dropped). */
export function replyText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** replyText with a wrapping ```json … ``` fence removed, for STRICT-JSON prompts. */
export function replyJson(content: Anthropic.ContentBlock[]): string {
  return replyText(content)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}
