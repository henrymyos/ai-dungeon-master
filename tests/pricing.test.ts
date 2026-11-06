import { test } from "node:test";
import assert from "node:assert/strict";
import { costFor, formatCost } from "../lib/pricing";

const zero = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };

test("costFor prices each token kind per million", () => {
  assert.equal(costFor(zero), 0);
  assert.equal(costFor({ ...zero, input_tokens: 1_000_000 }), 1);
  assert.equal(costFor({ ...zero, output_tokens: 1_000_000 }), 5);
  assert.equal(costFor({ ...zero, cache_read_tokens: 1_000_000 }), 0.1);
  assert.equal(costFor({ ...zero, cache_creation_tokens: 1_000_000 }), 1.25);
  // a typical turn: 2k in, 500 out, 10k cached read
  const turn = costFor({ input_tokens: 2000, output_tokens: 500, cache_read_tokens: 10_000, cache_creation_tokens: 0 });
  assert.ok(Math.abs(turn - 0.0055) < 1e-12);
});

test("formatCost picks precision by size", () => {
  assert.equal(formatCost(0), "<$0.001");
  assert.equal(formatCost(0.0009), "<$0.001");
  assert.equal(formatCost(0.0055), "$0.0055");
  assert.equal(formatCost(0.123), "$0.123");
  assert.equal(formatCost(12.345), "$12.35");
});
