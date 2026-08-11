#!/usr/bin/env node
// Usage: node benchmark.js <planner_module> <beamWidth> [mode]
// Runs one cold optimizeSevenStarTargets pass and prints a JSON result line.
'use strict';

const path = require('path');
const modulePath = path.resolve(process.argv[2] || './planner_baseline.js');
const beamWidth = process.argv[3] === 'unlimited' ? 'unlimited' : Number(process.argv[3] || 120);
const mode = process.argv[4] || 'guarantee';

const planner = require(modulePath);
const { buildFixture } = require('./fixture.js');

const fixture = buildFixture(planner);
const t0 = performance.now();
const result = planner.optimizeSevenStarTargets(fixture.targets, fixture.inventory, {
  mode,
  beamWidth,
  maxMs: 600000 // effectively no deadline: measure time-to-complete
});
const elapsed = performance.now() - t0;

const summary = {
  module: path.basename(modulePath),
  beamWidth,
  mode,
  crewKinds: fixture.crewCount,
  elapsedMs: Math.round(elapsed),
  reportedMs: result.elapsedMs,
  truncated: result.truncated,
  exploredStates: result.exploredStates,
  totalProduced: result.totalProduced,
  perTarget: result.targetResults.map((t) => `${t.targetId}:${t.produced}`).join(' '),
  satisfied: result.targetResults.filter((t) => t.satisfied).length,
  demandSize: Object.keys(result.demand || {}).length,
  recipeKinds: Object.keys(result.recipeCounts || {}).length,
  recipeTotal: Object.values(result.recipeCounts || {}).reduce((s, c) => s + c, 0)
};
console.log(JSON.stringify(summary));
