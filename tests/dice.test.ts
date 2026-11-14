import { test } from "node:test";
import assert from "node:assert/strict";
import { executeTool } from "../lib/tools";

// roll_dice without skill_name never touches the database, so these run offline.
async function roll(input: Record<string, unknown>) {
  const ev = await executeTool("roll_dice", input, "no-campaign");
  assert.equal(ev.kind, "roll_dice");
  return ev as Extract<typeof ev, { kind: "roll_dice" }>;
}

test("defaults to one d20 with rolls in range", async () => {
  for (let i = 0; i < 200; i++) {
    const r = await roll({});
    assert.equal(r.sides, 20);
    assert.equal(r.count, 1);
    assert.equal(r.rolls.length, 1);
    assert.ok(r.rolls[0] >= 1 && r.rolls[0] <= 20);
    assert.equal(r.total, r.rolls[0]);
    assert.equal(r.skill_bonus, 0);
  }
});

test("clamps sides to 2..100 and count to 1..10, garbage to the floor", async () => {
  const big = await roll({ sides: 1000, count: 50 });
  assert.equal(big.sides, 100);
  assert.equal(big.count, 10);
  assert.equal(big.rolls.length, 10);
  const small = await roll({ sides: "abc", count: -3 });
  assert.equal(small.sides, 2);
  assert.equal(small.count, 1);
});

test("multi-dice total is the sum", async () => {
  for (let i = 0; i < 100; i++) {
    const r = await roll({ sides: 6, count: 3 });
    assert.equal(r.total, r.rolls.reduce((a, b) => a + b, 0));
    assert.ok(r.rolls.every((n) => n >= 1 && n <= 6));
  }
});

test("advantage keeps the higher of two d20s, disadvantage the lower", async () => {
  for (let i = 0; i < 100; i++) {
    const a = await roll({ advantage: "advantage" });
    assert.equal(a.rolls.length, 2);
    assert.equal(a.count, 1);
    assert.equal(a.total, Math.max(...a.rolls));
    const d = await roll({ advantage: "disadvantage" });
    assert.equal(d.total, Math.min(...d.rolls));
  }
});

test("advantage is ignored unless it is a single d20; unknown values mean normal", async () => {
  const d6 = await roll({ sides: 6, advantage: "advantage" });
  assert.equal(d6.rolls.length, 1);
  const two = await roll({ count: 2, advantage: "advantage" });
  assert.equal(two.rolls.length, 2);
  assert.equal(two.total, two.rolls[0] + two.rolls[1]);
  assert.equal((await roll({ advantage: "lucky" })).advantage, "normal");
});
