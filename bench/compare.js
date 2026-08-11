#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SCENARIOS } = require('./fixture.js');

function parseArgs(argv) {
  const options = {
    baseline: argv[0],
    current: argv[1],
    samples: 7,
    hotMs: 200,
    hotSamples: 7,
    scenarios: SCENARIOS.map((scenario) => scenario.name),
    modes: ['guarantee', 'maximize'],
    widths: [60, 120, 300],
    output: ''
  };
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--samples') options.samples = Number(value);
    else if (flag === '--hot-ms') options.hotMs = Number(value);
    else if (flag === '--hot-samples') options.hotSamples = Number(value);
    else if (flag === '--scenarios' || flag === '--scenario') options.scenarios = value.split(',');
    else if (flag === '--modes' || flag === '--mode') options.modes = value.split(',');
    else if (flag === '--widths' || flag === '--width') options.widths = value.split(',').map(Number);
    else if (flag === '--output') options.output = value;
    else throw new Error(`unknown option: ${flag}`);
    index += 1;
  }
  if (!options.baseline || !options.current) {
    throw new Error('usage: node compare.js <baseline-module> <current-module> [--samples 7] [--hot-ms 200] [--output results.json]');
  }
  if (!Number.isInteger(options.samples) || options.samples < 7) {
    throw new Error('--samples must be at least 7');
  }
  if (!Number.isInteger(options.hotSamples) || options.hotSamples < 1 || options.hotMs < 200) {
    throw new Error('--hot-samples must be positive and --hot-ms must be at least 200');
  }
  return options;
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function runWorker(modulePath, scenario, mode, width, phase, options) {
  const workerPath = path.join(__dirname, 'worker.js');
  const args = [workerPath, path.resolve(modulePath), scenario, mode, String(width), phase];
  if (phase === 'hot') args.push(String(options.hotMs), String(options.hotSamples));
  const child = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
  if (child.status !== 0) {
    throw new Error(`worker failed (${scenario}/${mode}/${width}/${phase}):\n${child.stderr || child.stdout}`);
  }
  return JSON.parse(child.stdout.trim());
}

function qualityComparison(baseline, current) {
  const errors = [];
  if (!baseline.valid) errors.push(`baseline invalid: ${baseline.validationErrors.join('; ')}`);
  if (!current.valid) errors.push(`current invalid: ${current.validationErrors.join('; ')}`);
  baseline.satisfiedExpectedTargetIds.forEach((targetId) => {
    if (!current.satisfiedExpectedTargetIds.includes(targetId)) {
      errors.push(`previously satisfied expected target regressed: ${targetId}`);
    }
  });
  if (current.satisfied < baseline.satisfied) errors.push('satisfied target count decreased');
  if (current.totalProduced < baseline.totalProduced) errors.push('total production decreased');
  if (
    current.satisfied === baseline.satisfied &&
    current.totalProduced === baseline.totalProduced &&
    current.demandCost > baseline.demandCost + 1e-9
  ) {
    errors.push('demand cost increased at equal satisfaction and production');
  }
  return { pass: errors.length === 0, errors };
}

function compactResult(result) {
  const { fingerprint, validationErrors, ...summary } = result;
  return { ...summary, validationErrors };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const cases = [];
  for (const scenario of options.scenarios) {
    if (!SCENARIOS.some((item) => item.name === scenario)) throw new Error(`unknown scenario: ${scenario}`);
    for (const mode of options.modes) {
      if (!['guarantee', 'maximize'].includes(mode)) throw new Error(`unknown mode: ${mode}`);
      for (const width of options.widths) {
        if (![60, 120, 300].includes(width)) throw new Error(`unsupported benchmark width: ${width}`);
        process.stderr.write(`benchmark ${scenario} ${mode} beam=${width}\n`);
        const baselineCold = [];
        const currentCold = [];
        for (let sample = 0; sample < options.samples; sample += 1) {
          baselineCold.push(runWorker(options.baseline, scenario, mode, width, 'cold', options));
          currentCold.push(runWorker(options.current, scenario, mode, width, 'cold', options));
        }
        const baselineHot = runWorker(options.baseline, scenario, mode, width, 'hot', options);
        const currentHot = runWorker(options.current, scenario, mode, width, 'hot', options);
        const baselineColdMs = baselineCold.map((sample) => sample.elapsedMs);
        const currentColdMs = currentCold.map((sample) => sample.elapsedMs);
        const baselineColdMedian = median(baselineColdMs);
        const currentColdMedian = median(currentColdMs);
        const baselineHotMedian = median(baselineHot.samplesMs);
        const currentHotMedian = median(currentHot.samplesMs);
        const baselineResult = baselineCold[0].result;
        const currentResult = currentCold[0].result;
        const quality = qualityComparison(baselineResult, currentResult);
        const deterministic = {
          baseline: new Set(baselineCold.map((sample) => sample.result.fingerprint)).size === 1,
          current: new Set(currentCold.map((sample) => sample.result.fingerprint)).size === 1
        };
        const expectedPoolCount = currentResult.targetProduction ? Object.keys(currentResult.targetProduction).length : 0;
        const cache = {
          baselineFillMisses: baselineHot.fill.cacheMisses,
          baselineHotHits: baselineHot.result.cacheHits,
          currentFillMisses: currentHot.fill.cacheMisses,
          currentHotHits: currentHot.result.cacheHits,
          currentColdMiss: currentResult.cacheHits === 0 && currentResult.cacheMisses === expectedPoolCount,
          currentHotHit: currentHot.result.cacheMisses === 0 && currentHot.result.cacheHits === expectedPoolCount,
          hotResultsValid: currentHot.fill.valid && currentHot.result.valid,
          qualityMatchesCold: currentResult.fingerprint === currentHot.fill.fingerprint &&
            currentResult.fingerprint === currentHot.result.fingerprint
        };
        cases.push({
          scenario,
          mode,
          beamWidth: width,
          cold: {
            baselineSamplesMs: baselineColdMs,
            currentSamplesMs: currentColdMs,
            baselineMedianMs: baselineColdMedian,
            currentMedianMs: currentColdMedian,
            ratio: currentColdMedian / baselineColdMedian
          },
          hot: {
            baselineSamplesMs: baselineHot.samplesMs,
            currentSamplesMs: currentHot.samplesMs,
            baselineMedianMs: baselineHotMedian,
            currentMedianMs: currentHotMedian,
            ratio: currentHotMedian / baselineHotMedian,
            baselineCalls: baselineHot.calls,
            currentCalls: currentHot.calls
          },
          deterministic,
          cache,
          quality,
          baseline: compactResult(baselineResult),
          current: compactResult(currentResult)
        });
      }
    }
  }

  const coldBaselineMedian = median(cases.map((item) => item.cold.baselineMedianMs));
  const coldCurrentMedian = median(cases.map((item) => item.cold.currentMedianMs));
  const hotBaselineMedian = median(cases.map((item) => item.hot.baselineMedianMs));
  const hotCurrentMedian = median(cases.map((item) => item.hot.currentMedianMs));
  const regressions = cases.filter((item) => item.cold.baselineMedianMs >= 1 && item.cold.ratio > 1.1);
  const failures = cases.filter((item) => (
    !item.quality.pass || !item.deterministic.baseline || !item.deterministic.current ||
    !item.cache.currentColdMiss || !item.cache.currentHotHit || !item.cache.hotResultsValid ||
    !item.cache.qualityMatchesCold || item.current.truncated
  ));
  const summary = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    baselineModule: path.resolve(options.baseline),
    currentModule: path.resolve(options.current),
    configuration: {
      coldSamplesPerCase: options.samples,
      hotSamplesPerCase: options.hotSamples,
      minimumHotBatchMs: options.hotMs,
      scenarios: options.scenarios,
      modes: options.modes,
      beamWidths: options.widths
    },
    aggregate: {
      cold: {
        baselineMedianMs: coldBaselineMedian,
        currentMedianMs: coldCurrentMedian,
        ratio: coldCurrentMedian / coldBaselineMedian,
        atLeastTwoTimesFaster: coldCurrentMedian <= coldBaselineMedian * 0.5
      },
      hot: {
        baselineMedianMs: hotBaselineMedian,
        currentMedianMs: hotCurrentMedian,
        ratio: hotCurrentMedian / hotBaselineMedian,
        atLeastTwoTimesFaster: hotCurrentMedian <= hotBaselineMedian * 0.5
      }
    },
    gates: {
      qualityAndCorrectness: failures.length === 0,
      noColdRegressionOverTenPercent: regressions.length === 0,
      pass: failures.length === 0 && regressions.length === 0 &&
        coldCurrentMedian <= coldBaselineMedian * 0.5 && hotCurrentMedian <= hotBaselineMedian * 0.5,
      failingCases: failures.map((item) => `${item.scenario}/${item.mode}/${item.beamWidth}`),
      coldRegressions: regressions.map((item) => `${item.scenario}/${item.mode}/${item.beamWidth}`)
    },
    cases
  };
  const json = `${JSON.stringify(summary, null, 2)}\n`;
  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);
    process.stderr.write(`written ${outputPath}\n`);
  }
  process.stdout.write(json);
  if (!summary.gates.pass) process.exitCode = 1;
}

main();
