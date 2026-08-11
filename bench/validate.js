#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { buildFixture } = require('./fixture.js');

const modulePath = path.resolve(process.argv[2] || './bench/planner_current.js');
const planner = require(modulePath);
const tests = [];

function check(name, condition, details = '') {
  tests.push({ name, pass: Boolean(condition), details: condition ? '' : details });
}

function freshStats() {
  return { routePoolCacheHits: 0, routePoolCacheMisses: 0, upperBoundPruned: 0 };
}

function buildPool(targetId, inventory, beamWidth, deadline = Infinity, routeOptions = {}) {
  const stats = freshStats();
  const pool = planner.buildTargetRoutePool({ targetId }, inventory, {
    ...routeOptions,
    beamWidth,
    deadline,
    stats
  });
  return { pool, stats };
}

function coldWorker(scenario, mode, width) {
  const child = spawnSync(process.execPath, [
    path.join(__dirname, 'worker.js'),
    modulePath,
    scenario,
    mode,
    String(width),
    'cold'
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (child.status !== 0) throw new Error(child.stderr || child.stdout);
  return JSON.parse(child.stdout).result;
}

const first = buildPool('110', { 14: 1 }, 60);
const second = buildPool('110', { 14: 1 }, 60);
check('first identical route-pool lookup misses', first.stats.routePoolCacheMisses === 1 && !first.pool.fromCache);
check('second identical route-pool lookup hits', second.stats.routePoolCacheHits === 1 && second.pool.fromCache);

const changedInventory = buildPool('110', { 14: 2 }, 60);
const changedTarget = buildPool('114', { 14: 1 }, 60);
const changedWidth = buildPool('110', { 14: 1 }, 120);
check('inventory change produces a miss', changedInventory.stats.routePoolCacheMisses === 1);
check('target change produces a miss', changedTarget.stats.routePoolCacheMisses === 1);
check('beam width change produces a miss', changedWidth.stats.routePoolCacheMisses === 1);

const firstRequiredCount = buildPool('381', { 14: 1 }, 60, Infinity, { requiredCounts: [65] });
const changedRequiredCount = buildPool('381', { 14: 1 }, 60, Infinity, { requiredCounts: [66] });
check('required target count change produces a miss',
  firstRequiredCount.stats.routePoolCacheMisses === 1 && changedRequiredCount.stats.routePoolCacheMisses === 1);

for (let quantity = 1; quantity <= 81; quantity += 1) {
  buildPool('125', { 9: quantity }, 300);
}
const evicted = buildPool('110', { 14: 1 }, 60);
check('route-pool cache evicts the least recently used item after 80 entries', evicted.stats.routePoolCacheMisses === 1 && !evicted.pool.fromCache);

const truncatedInventory = { 11: 1000 };
const truncated = buildPool('196', truncatedInventory, 120, performance.now() - 1);
const afterTruncated = buildPool('196', truncatedInventory, 120, Infinity);
check('past deadline truncates route-pool search', truncated.pool.truncated);
check('truncated route-pool is not cached', afterTruncated.stats.routePoolCacheMisses === 1 && !afterTruncated.pool.fromCache);

const emptyTargets = planner.optimizeSevenStarTargets([], {}, { mode: 'guarantee', beamWidth: 60 });
const noEnabledTargets = planner.optimizeSevenStarTargets([
  { targetId: '110', priority: 1, desiredCount: 1, order: 1, enabled: false }
], {}, { mode: 'guarantee', beamWidth: 60 });
const emptyInventory = planner.optimizeSevenStarTargets([
  { targetId: '110', priority: 1, desiredCount: 1, order: 1, enabled: true }
], {}, { mode: 'guarantee', beamWidth: 60, maxMs: 600000 });
check('empty target list returns a stable zero result', emptyTargets.totalProduced === 0 && emptyTargets.targetResults.length === 0 && !emptyTargets.truncated);
check('no enabled target returns a stable zero result', noEnabledTargets.totalProduced === 0 && noEnabledTargets.targetResults.length === 0 && !noEnabledTargets.truncated);
check('empty inventory returns zero without throwing', emptyInventory.totalProduced === 0 && emptyInventory.targetResults[0]?.produced === 0);

const coldA = coldWorker('large-six', 'guarantee', 120);
const coldB = coldWorker('large-six', 'guarantee', 120);
check('two cold runs are deterministic', coldA.fingerprint === coldB.fingerprint);
check('representative result passes legality checks', coldA.valid, coldA.validationErrors.join('; '));

const fixture = buildFixture(planner);
const defaultDeadline = planner.optimizeSevenStarTargets(fixture.targets, fixture.inventory, {
  mode: 'guarantee',
  beamWidth: 120
});
check('representative default-deadline run is not truncated', !defaultDeadline.truncated);

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  module: modulePath,
  pass: tests.every((test) => test.pass),
  tests
};
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
