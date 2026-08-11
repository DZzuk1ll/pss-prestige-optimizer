#!/usr/bin/env node
'use strict';

const path = require('path');
const { buildScenario } = require('./fixture.js');

const modulePath = path.resolve(process.argv[2]);
const scenarioName = process.argv[3];
const mode = process.argv[4] === 'maximize' ? 'maximize' : 'guarantee';
const beamWidth = process.argv[5] === 'unlimited' ? 'unlimited' : Number(process.argv[5]);
const phase = process.argv[6] || 'cold';
const minHotMs = Number(process.argv[7] || 200);
const hotSamples = Number(process.argv[8] || 7);
const planner = require(modulePath);
const fixture = buildScenario(planner, scenarioName);

function normalizeObject(value) {
  return Object.fromEntries(Object.entries(value || {})
    .filter(([, count]) => Number(count) > 0)
    .sort(([left], [right]) => Number(left) - Number(right)));
}

function sameObject(left, right) {
  return JSON.stringify(normalizeObject(left)) === JSON.stringify(normalizeObject(right));
}

function getDemandCost(demand, inventory) {
  return Object.entries(demand || {}).reduce((sum, [id, count]) => {
    const owned = Math.max(1, Math.floor(Number(inventory[id])) || 0);
    const rarity = Math.max(1, planner.getCrewInfo(id).rarity);
    return sum + Number(count) * (1 + rarity / 10) * (1 + 1 / owned);
  }, 0);
}

function validateResult(result) {
  const errors = [];
  const start = normalizeObject(fixture.inventory);
  const working = { ...start };
  const production = {};
  const entries = Object.entries(result.recipeCounts || {}).map(([key, rawCount]) => ({
    recipe: planner.RECIPE_BOOK.byKey[key],
    key,
    count: Number(rawCount)
  })).sort((left, right) => {
    const leftRarity = left.recipe ? planner.getCrewInfo(left.recipe.out).rarity : Infinity;
    const rightRarity = right.recipe ? planner.getCrewInfo(right.recipe.out).rarity : Infinity;
    return leftRarity - rightRarity || left.key.localeCompare(right.key);
  });

  entries.forEach(({ recipe, key, count }) => {
    if (!recipe) {
      errors.push(`unknown recipe ${key}`);
      return;
    }
    if (!Number.isSafeInteger(count) || count < 0) {
      errors.push(`invalid recipe count ${key}:${count}`);
      return;
    }
    const aNeed = recipe.a === recipe.b ? count * 2 : count;
    const bNeed = recipe.a === recipe.b ? 0 : count;
    if ((working[recipe.a] || 0) < aNeed || (working[recipe.b] || 0) < bNeed) {
      errors.push(`recipe exceeds available inventory ${key}`);
    }
    working[recipe.a] = (working[recipe.a] || 0) - aNeed;
    if (recipe.a !== recipe.b) {
      working[recipe.b] = (working[recipe.b] || 0) - bNeed;
    }
    working[recipe.out] = (working[recipe.out] || 0) + count;
    production[recipe.out] = (production[recipe.out] || 0) + count;
  });

  Object.entries(working).forEach(([id, count]) => {
    if (count < 0) errors.push(`negative remaining inventory ${id}:${count}`);
    if (count <= 0) delete working[id];
  });
  const demand = {};
  new Set([...Object.keys(start), ...Object.keys(working)]).forEach((id) => {
    const used = (start[id] || 0) - (working[id] || 0);
    if (used > 0) demand[id] = used;
  });

  Object.entries(result.demand || {}).forEach(([id, count]) => {
    if (Number(count) > Number(start[id] || 0)) errors.push(`demand exceeds input ${id}:${count}`);
  });
  if (!sameObject(result.remaining, working)) errors.push('remaining does not match recipe execution');
  if (!sameObject(result.production, production)) errors.push('production does not match recipe counts');
  if (!sameObject(result.demand, demand)) errors.push('demand does not match recipe execution');

  const targetProduction = {};
  (result.targetResults || []).forEach((target) => {
    targetProduction[target.targetId] = Number(target.produced) || 0;
    if ((Number(production[target.targetId]) || 0) !== (Number(target.produced) || 0)) {
      errors.push(`target production mismatch ${target.targetId}`);
    }
  });
  const totalProduced = Object.values(targetProduction).reduce((sum, count) => sum + count, 0);
  if (totalProduced !== result.totalProduced) errors.push('totalProduced mismatch');

  return { valid: errors.length === 0, errors };
}

function summarize(result) {
  const legality = validateResult(result);
  const targetProduction = Object.fromEntries((result.targetResults || []).map((target) => [target.targetId, target.produced]));
  const satisfiedExpectedTargetIds = (result.targetResults || [])
    .filter((target) => target.desiredCount > 0 && target.satisfied)
    .map((target) => target.targetId);
  const expectedSatisfied = satisfiedExpectedTargetIds.length;
  const enabledExpected = fixture.targets.filter((target) => target.enabled && target.desiredCount > 0).length;
  return {
    cacheHits: result.searchStats?.routePoolCacheHits || 0,
    cacheMisses: result.searchStats?.routePoolCacheMisses || 0,
    truncated: Boolean(result.truncated),
    expectedSatisfied,
    satisfiedExpectedTargetIds,
    enabledExpected,
    satisfied: (result.targetResults || []).filter((target) => target.satisfied).length,
    targetProduction,
    totalProduced: result.totalProduced,
    demandCost: getDemandCost(result.demand, fixture.inventory),
    valid: legality.valid,
    validationErrors: legality.errors,
    fingerprint: JSON.stringify({ targetProduction, recipeCounts: result.recipeCounts || {} })
  };
}

function optimize() {
  return planner.optimizeSevenStarTargets(fixture.targets, fixture.inventory, {
    mode,
    beamWidth,
    maxMs: 600000
  });
}

if (phase === 'cold') {
  const startedAt = process.hrtime.bigint();
  const result = optimize();
  const elapsedNs = process.hrtime.bigint() - startedAt;
  console.log(JSON.stringify({
    phase,
    module: path.basename(modulePath),
    scenario: scenarioName,
    mode,
    beamWidth,
    elapsedMs: Number(elapsedNs) / 1e6,
    result: summarize(result)
  }));
} else if (phase === 'hot') {
  const fill = optimize();
  const samplesMs = [];
  let calls = 0;
  let last = fill;
  for (let sample = 0; sample < hotSamples; sample += 1) {
    let sampleCalls = 0;
    const startedAt = process.hrtime.bigint();
    let elapsedNs = 0n;
    do {
      last = optimize();
      sampleCalls += 1;
      elapsedNs = process.hrtime.bigint() - startedAt;
    } while (Number(elapsedNs) / 1e6 < minHotMs);
    calls += sampleCalls;
    samplesMs.push(Number(elapsedNs) / 1e6 / sampleCalls);
  }
  console.log(JSON.stringify({
    phase,
    module: path.basename(modulePath),
    scenario: scenarioName,
    mode,
    beamWidth,
    minBatchMs: minHotMs,
    calls,
    samplesMs,
    fill: summarize(fill),
    result: summarize(last)
  }));
} else {
  throw new Error(`unknown worker phase: ${phase}`);
}
