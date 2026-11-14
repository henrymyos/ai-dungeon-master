import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketCount, checkRate, rateLimitResponse } from "../lib/ratelimit";

test("checkRate allows up to the limit, then blocks until the window slides", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const key = "test:slide";
  assert.deepEqual(checkRate(key, 2, 60_000), { allowed: true, remaining: 1, resetAt: 1_060_000 });
  t.mock.timers.tick(10_000);
  assert.equal(checkRate(key, 2, 60_000).remaining, 0);
  const blocked = checkRate(key, 2, 60_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.resetAt, 1_060_000); // oldest hit + window
  t.mock.timers.tick(50_001); // first hit falls out of the window
  assert.equal(checkRate(key, 2, 60_000).allowed, true);
  assert.equal(checkRate(key, 2, 60_000).allowed, false);
});

test("checkRate keys are independent and blocked calls don't count", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 5_000_000 });
  assert.equal(checkRate("test:a", 1, 1000).allowed, true);
  assert.equal(checkRate("test:b", 1, 1000).allowed, true);
  for (let i = 0; i < 5; i++) assert.equal(checkRate("test:a", 1, 1000).allowed, false);
  t.mock.timers.tick(1001);
  assert.equal(checkRate("test:a", 1, 1000).allowed, true);
});

test("rateLimitResponse is a 429 with Retry-After of at least 1s", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const res = rateLimitResponse({ allowed: false, remaining: 0, resetAt: 2500 }, "slow down");
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "3");
  assert.deepEqual(await res.json(), { error: "slow down", retryAfterSec: 3 });
  const past = rateLimitResponse({ allowed: false, remaining: 0, resetAt: -5 }, "x");
  assert.equal(past.headers.get("Retry-After"), "1");
});

test("checkRate forgets visitors whose window has passed", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 9_000_000 });
  for (let i = 0; i < 5000; i++) {
    t.mock.timers.tick(1000);
    checkRate(`test:visitor${i}`, 30, 60_000);
  }
  assert.ok(bucketCount() < 2100, `kept ${bucketCount()} buckets`);
  // A still-active visitor keeps its history through a prune.
  assert.equal(checkRate("test:visitor4999", 1, 60_000).allowed, false);
});
