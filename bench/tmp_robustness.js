'use strict';
// 临时稳健性自测：不同 seed/目标集合下对比 baseline 与 v3 的质量。
const path = require('path');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCase(planner, targetIds, seed, fourN, fiveN) {
  const closure = planner.buildSelectedTargetClosure(targetIds);
  const fourStar = [], fiveStar = [];
  closure.crewIds.forEach((id) => {
    const rarity = planner.getCrewInfo(id).rarity;
    if (rarity === 4) fourStar.push(id);
    if (rarity === 5) fiveStar.push(id);
  });
  fourStar.sort((a, b) => Number(a) - Number(b));
  fiveStar.sort((a, b) => Number(a) - Number(b));
  const rand = mulberry32(seed);
  const pick = (list, n) => {
    const copy = list.slice(); const out = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
    return out;
  };
  const inventory = {};
  pick(fourStar, fourN).forEach((id) => { inventory[id] = 1 + Math.floor(rand() * 6); });
  pick(fiveStar, fiveN).forEach((id) => { inventory[id] = 1 + Math.floor(rand() * 4); });
  const targets = targetIds.map((targetId, index) => ({
    targetId, priority: index + 1, desiredCount: index < 1 ? 1 : 0, order: index + 1, enabled: true
  }));
  return { inventory, targets };
}

const CASES = [
  { name: 'A: 3目标(381,437,147) seed=99991', targets: ['381', '437', '147'], seed: 99991, four: 24, five: 16 },
  { name: 'B: 3目标(270,383,466) seed=424242', targets: ['270', '383', '466'], seed: 424242, four: 24, five: 16 },
  { name: 'C: 基准6目标 seed=777', targets: ['110', '114', '115', '116', '125', '196'], seed: 777, four: 34, five: 26 }
];

const modulePath = path.resolve(process.argv[2]);
const planner = require(modulePath);
const caseIdx = Number(process.argv[3]);
const c = CASES[caseIdx];
const fx = buildCase(planner, c.targets, c.seed, c.four, c.five);
const t0 = performance.now();
const res = planner.optimizeSevenStarTargets(fx.targets, fx.inventory, { mode: 'guarantee', beamWidth: 60, maxMs: 600000 });
const ms = Math.round(performance.now() - t0);
console.log(JSON.stringify({
  module: path.basename(modulePath), case: c.name, elapsedMs: ms,
  totalProduced: res.totalProduced,
  perTarget: res.targetResults.map((t) => `${t.targetId}:${t.produced}`).join(' '),
  satisfied: res.targetResults.filter((t) => t.satisfied).length + '/' + res.targetResults.length
}));
