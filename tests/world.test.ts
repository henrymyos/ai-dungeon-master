import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTimeOfDay, formatTime, worldStateForPrompt } from "../lib/world";
import type { DmWorld } from "../lib/db";

const base: DmWorld = {
  time_minutes: 8 * 60 + 5,
  day_count: 3,
  weather: "light rain",
  npcs: [],
  locations: [],
  lore: [],
  statuses: [],
  encounter: null,
  quests: [],
  arc: null,
  current_beat: 0,
};

test("formatTime wraps past midnight and zero-pads", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(8 * 60 + 5), "08:05");
  assert.equal(formatTime(23 * 60 + 59), "23:59");
  assert.equal(formatTime(1440 + 90), "01:30");
});

test("describeTimeOfDay buckets each hour boundary", () => {
  const at = (h: number) => describeTimeOfDay(h * 60);
  assert.equal(at(0), "deep night");
  assert.equal(at(5), "predawn");
  assert.equal(at(7), "early morning");
  assert.equal(at(9), "midmorning");
  assert.equal(at(12), "midday");
  assert.equal(at(14), "afternoon");
  assert.equal(at(17), "evening");
  assert.equal(at(19), "night");
  assert.equal(at(22), "late night");
  assert.equal(describeTimeOfDay(1440 + 12 * 60), "midday");
});

test("worldStateForPrompt with an empty world prints only time and weather", () => {
  assert.equal(
    worldStateForPrompt(base),
    "## Current world state\nTime: Day 3, 08:05 (early morning)\nWeather: light rain",
  );
});

const arc = {
  acts: [
    { name: "Act I", beats: [{ title: "Arrival", goal: "reach town" }] },
    { name: "Act II", beats: [{ title: "Heist", goal: "steal the key" }, { title: "Finale", goal: "escape" }] },
  ],
};

test("worldStateForPrompt shows current and next beat across acts", () => {
  const out = worldStateForPrompt({ ...base, arc, current_beat: 0 });
  assert.match(out, /Current beat \(Act I\): Arrival — reach town/);
  assert.match(out, /Next beat \(Act II\): Heist — steal the key/);
  assert.doesNotMatch(out, /final beat/);
});

test("worldStateForPrompt clamps a beat index past the end to the final beat", () => {
  for (const current_beat of [2, 99]) {
    const out = worldStateForPrompt({ ...base, arc, current_beat });
    assert.match(out, /Current beat \(Act II\): Finale — escape/);
    assert.doesNotMatch(out, /Next beat/);
    assert.match(out, /This is the final beat/);
  }
});

test("worldStateForPrompt skips an arc with no acts", () => {
  assert.doesNotMatch(worldStateForPrompt({ ...base, arc: { acts: [] } }), /HIDDEN DM NOTES/);
});

test("worldStateForPrompt lists only active quests and marks defeated enemies", () => {
  const q = (name: string, status: DmWorld["quests"][number]["status"]) =>
    ({ name, description: `${name} desc`, status }) as DmWorld["quests"][number];
  const out = worldStateForPrompt({
    ...base,
    quests: [q("Find the cat", "active"), q("Old job", "completed")],
    encounter: {
      name: "Ambush",
      description: "",
      enemies: [
        { name: "Goblin", hp: 3, max_hp: 7, is_active: true, description: "" },
        { name: "Wolf", hp: 0, max_hp: 9, is_active: false, description: "grey" },
      ],
    } as unknown as DmWorld["encounter"],
  });
  assert.match(out, /- Find the cat: Find the cat desc/);
  assert.doesNotMatch(out, /Old job/);
  assert.match(out, /Active encounter: Ambush\n/);
  assert.match(out, /· Goblin \(3\/7 HP\)\n/);
  assert.match(out, /· Wolf \(defeated\) — grey/);
});

test("worldStateForPrompt caps NPCs and locations at 12", () => {
  const npcs = Array.from({ length: 15 }, (_, i) =>
    ({ name: `N${i}`, attitude: "neutral", relationship: 0, description: "d" }) as unknown as DmWorld["npcs"][number],
  );
  const out = worldStateForPrompt({ ...base, npcs });
  assert.match(out, /- N11 \(neutral, relationship 0\): d/);
  assert.doesNotMatch(out, /- N12 /);
});
