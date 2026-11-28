import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { replyJson, replyText } from "../lib/reply-text";

const text = (t: string) => ({ type: "text", text: t, citations: null }) as Anthropic.TextBlock;
const tool = { type: "tool_use", id: "t1", name: "x", input: {} } as Anthropic.ToolUseBlock;

test("replyText joins text blocks, skips others, trims", () => {
  assert.equal(replyText([text("  Hello "), tool, text("world.  ")]), "Hello world.");
  assert.equal(replyText([tool]), "");
});

test("replyJson strips a json fence, plain fence, or none", () => {
  assert.equal(replyJson([text('```json\n{"a":1}\n```')]), '{"a":1}');
  assert.equal(replyJson([text('```JSON {"a":1}```')]), '{"a":1}');
  assert.equal(replyJson([text('```\n{"a":1}\n```\n')]), '{"a":1}');
  assert.equal(replyJson([text(' {"a":1} ')]), '{"a":1}');
  assert.deepEqual(JSON.parse(replyJson([text("```json\n"), text('{"b":[2]}\n```')])), { b: [2] });
});
