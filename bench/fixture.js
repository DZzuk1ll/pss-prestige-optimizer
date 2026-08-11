'use strict';
// Deterministic benchmark matrix shared by the cold/hot runner and validation.

const TARGET_IDS = ['110', '114', '115', '116', '125', '196'];

const SCENARIOS = [
  {
    name: 'large-six',
    description: '现有 6 目标大库存场景',
    targetIds: TARGET_IDS,
    seed: 20260612,
    fourStarKinds: 34,
    fiveStarKinds: 26,
    desiredTargets: 2
  },
  {
    name: 'trio-a',
    description: '3 目标 (381,437,147)，seed=99991',
    targetIds: ['381', '437', '147'],
    seed: 99991,
    fourStarKinds: 24,
    fiveStarKinds: 16,
    desiredTargets: 1
  },
  {
    name: 'trio-b',
    description: '3 目标 (270,383,466)，seed=424242',
    targetIds: ['270', '383', '466'],
    seed: 424242,
    fourStarKinds: 24,
    fiveStarKinds: 16,
    desiredTargets: 1
  },
  {
    name: 'single-deep',
    description: '单目标深层合成',
    targetIds: ['115'],
    seed: 777,
    fourStarKinds: 30,
    fiveStarKinds: 20,
    desiredTargets: 0
  },
  {
    name: 'empty-inventory',
    description: '空库存且存在启用目标',
    targetIds: ['110'],
    seed: 1,
    fourStarKinds: 0,
    fiveStarKinds: 0,
    desiredTargets: 1,
    emptyInventory: true
  },
  {
    name: 'no-enabled-targets',
    description: '无启用目标边界场景',
    targetIds: ['110', '114'],
    seed: 20260612,
    fourStarKinds: 12,
    fiveStarKinds: 8,
    desiredTargets: 1,
    disableAll: true
  }
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCase(planner, definition) {
  const closure = planner.buildSelectedTargetClosure(definition.targetIds);
  const fourStar = [];
  const fiveStar = [];
  closure.crewIds.forEach((id) => {
    const rarity = planner.getCrewInfo(id).rarity;
    if (rarity === 4) fourStar.push(id);
    if (rarity === 5) fiveStar.push(id);
  });
  fourStar.sort((a, b) => Number(a) - Number(b));
  fiveStar.sort((a, b) => Number(a) - Number(b));

  const random = mulberry32(definition.seed);
  const pick = (list, count) => {
    const copy = list.slice();
    const selected = [];
    while (selected.length < count && copy.length) {
      selected.push(copy.splice(Math.floor(random() * copy.length), 1)[0]);
    }
    return selected;
  };

  const chosenFour = definition.emptyInventory ? [] : pick(fourStar, definition.fourStarKinds);
  const chosenFive = definition.emptyInventory ? [] : pick(fiveStar, definition.fiveStarKinds);
  const inventory = {};
  chosenFour.forEach((id) => {
    inventory[id] = 1 + Math.floor(random() * 6);
  });
  chosenFive.forEach((id) => {
    inventory[id] = 1 + Math.floor(random() * 4);
  });

  const targets = definition.targetIds.map((targetId, index) => ({
    targetId,
    priority: index + 1,
    desiredCount: index < definition.desiredTargets ? 1 : 0,
    order: index + 1,
    enabled: !definition.disableAll
  }));

  return {
    name: definition.name,
    description: definition.description,
    inventory,
    targets,
    crewCount: chosenFour.length + chosenFive.length
  };
}

function getScenario(name) {
  const scenario = SCENARIOS.find((item) => item.name === name);
  if (!scenario) {
    throw new Error(`unknown benchmark scenario: ${name}`);
  }
  return scenario;
}

function buildScenario(planner, name) {
  return buildCase(planner, getScenario(name));
}

function buildFixture(planner) {
  return buildScenario(planner, 'large-six');
}

module.exports = {
  TARGET_IDS,
  SCENARIOS,
  mulberry32,
  buildCase,
  getScenario,
  buildScenario,
  buildFixture
};
