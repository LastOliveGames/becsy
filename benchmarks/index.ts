import {dirname, resolve as resolvePath} from 'path';
import {fileURLToPath} from 'url';
import {Worker} from 'worker_threads';
import {writeFileSync, readFileSync, existsSync} from 'fs';
import chalk from 'chalk';

const BENCHMARKS = [
  'ecs-benchmark'
];

type Results = {
  [key: string]: {devOps: number, devRel: number, perfOps: number, perfRel: number}
};

const OPS_WIDTH = 14;
const DIFF_WIDTH = 5;
const COLS = [0, 15, OPS_WIDTH, DIFF_WIDTH + 2, OPS_WIDTH, DIFF_WIDTH + 2];
const WORKER_FILE = resolveLocalPath('indexworker.js');
const LAST_RESULTS_FILE = './benchmarks/results.json';
const CURRENT_RESULTS_FILE = './benchmarks/current_results.json';

const lastResults: Results = existsSync(LAST_RESULTS_FILE) ?
  JSON.parse(readFileSync(LAST_RESULTS_FILE, {encoding: 'utf8'})) : undefined;
const results: Results = {};
const errors: string[] = [];

const {ops: baselineOps} = await delegateBench({baseline: true});
results.baseline = {devOps: baselineOps, devRel: 1, perfOps: baselineOps, perfRel: 1};

console.log(
  ' ', ' '.repeat(COLS[1]),
  'dev     '.padStart(COLS[2]), ' '.repeat(COLS[3]),
  'perf     '.padStart(COLS[4]), ' '.repeat(COLS[5])
);
for (const filename of BENCHMARKS) {
  console.log(filename);
  let index = 0;
  while (true) {
    const {name, ops: devOps, error: devError} = await delegateBench({filename, index, env: 'dev'});
    if (!name) break;
    const key = `${filename}/${name}`;
    const {ops: perfOps, error: perfError} = await delegateBench({filename, index, env: 'perf'});
    const devRel = devOps / baselineOps;
    const perfRel = perfOps / baselineOps;
    results[key] = {devOps, devRel, perfOps, perfRel};
    if (devError) errors.push(devError);
    if (perfError) errors.push(perfError);
    const lastDevRel = lastResults?.[key].devRel;
    const lastPerfRel = lastResults?.[key].perfRel;
    const devDiff = lastDevRel ? (devRel - lastDevRel) / lastDevRel : 0;
    const perfDiff = lastPerfRel ? (perfRel - lastPerfRel) / lastPerfRel : 0;
    console.log(
      ' ',
      name.padEnd(15),
      (devError ? 'ERROR     ' : `${devOps.toLocaleString()} op/s`).padStart(OPS_WIDTH),
      formatDiff(devDiff),
      (perfError ? 'ERROR     ' : `${perfOps.toLocaleString()} op/s`).padStart(OPS_WIDTH),
      formatDiff(perfDiff)
    );
    index += 1;
  }
}

console.log();
if (errors.length) {
  console.log('Errors:');
  for (const error of errors) console.log(error);
}

writeFileSync(CURRENT_RESULTS_FILE, JSON.stringify(results, undefined, 2));


function delegateBench(workerData: any): Promise<{name?: string, ops: number, error?: string}> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_FILE, {workerData});
    worker.on('message', resolve);
    worker.on('error', reject);
  });
}

function resolveLocalPath(filename: string): string {
  return resolvePath(dirname(fileURLToPath(import.meta.url)), filename);
}

function formatDiff(diff: number): string {
  if (Math.abs(diff) < 0.05) return ' '.repeat(DIFF_WIDTH + 2);
  const color = diff > 0 ? 'green' : 'red';
  const sign = diff > 0 ? '+' : '';
  const value = (diff * 100).toFixed(0);
  return '(' + chalk[color](`${sign}${value}%`.padStart(DIFF_WIDTH)) + ')';
}
