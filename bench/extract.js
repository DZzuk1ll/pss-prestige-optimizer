#!/usr/bin/env node
// Extracts the planner-core module from the single-file HTML app into a
// requireable CommonJS module so it can be benchmarked under Node.
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_HTML_PATH = path.join(__dirname, '..', '最优化合成路线计算器-W1N9.html');
const args = process.argv.slice(2);
// Preferred usage: node extract.js [source.html] [output.js]. Keep the old
// one-positional-output form working for local benchmark scripts.
const firstIsHtml = args[0] && path.extname(args[0]).toLowerCase() === '.html';
const HTML_PATH = path.resolve(firstIsHtml ? args[0] : DEFAULT_HTML_PATH);
const OUT_PATH = path.resolve(firstIsHtml ? (args[1] || path.join(__dirname, 'planner_current.js')) : (args[0] || path.join(__dirname, 'planner_current.js')));

const html = fs.readFileSync(HTML_PATH, 'utf8');
const lines = html.split('\n');

function findLine(predicate, from = 0) {
  for (let i = from; i < lines.length; i += 1) {
    if (predicate(lines[i])) {
      return i;
    }
  }
  throw new Error('marker not found');
}

// Marker-based ranges from the HTML layout.
const dataStart = findLine((l) => l.startsWith('const DATA = '));
const coreStart = findLine((l) => l.startsWith('const STAR_LABELS = '));
const appMarker = findLine((l) => l.includes('MODULE: app'));
const coreEnd = appMarker - 2; // skip the comment banner above MODULE: app

const helperStart = findLine((l) => l.startsWith('function normalizeBeamWidth'));
const helperEnd = findLine((l) => l.startsWith('function loadState')) - 1;

const parts = [];
parts.push("'use strict';");
parts.push(`// AUTO-GENERATED from ${path.basename(HTML_PATH)} — do not edit by hand.`);
parts.push(lines.slice(dataStart, dataStart + 2).join('\n'));
parts.push('const WAREHOUSE_STAR_OPTIONS = [1, 2, 3, 4, 5];');
parts.push(lines.slice(coreStart, coreEnd + 1).join('\n'));
parts.push(lines.slice(helperStart, helperEnd + 1).join('\n'));
parts.push('const SEVEN_STAR_TARGET_IDS = getCrewIdsByStar(7);');
parts.push(`
module.exports = {
  DATA,
  RECIPE_BOOK,
  getCrewInfo,
  getAllCrewIds,
  getCrewIdsByStar,
  getSevenStarTargetIds,
  buildSelectedTargetClosure,
  buildTargetRoutePool,
  optimizeRoutePools,
  optimizeSevenStarTargets,
  analyzeSingleTarget,
  cleanWarehouseInventory,
  cloneInventory,
  normalizeBeamWidth,
  normalizeOptimizationTargets
};
`);

fs.writeFileSync(OUT_PATH, parts.join('\n\n'));
console.log('written', OUT_PATH);
