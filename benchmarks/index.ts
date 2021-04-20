import {dirname, resolve as resolvePath} from 'path';
import {fileURLToPath} from 'url';
import {Worker} from 'worker_threads';

const BENCHMARKS = [
  'ecs-benchmark'
];

const OPS_WIDTH = 14;
const WORKER_FILE = resolvePath(dirname(fileURLToPath(import.meta.url)), 'worker.js');

const results: {[key: string]: {dev: number, perf: number}} = {};
const errors: string[] = [];

const {ops: baselineOps} = await delegateBench({baseline: true});
results.baseline = {dev: baselineOps, perf: baselineOps};
console.log('baseline', baselineOps, 'op/s');

console.log(' ', ' '.repeat(15), 'dev     '.padStart(OPS_WIDTH), 'perf     '.padStart(OPS_WIDTH));
for (const filename of BENCHMARKS) {
  console.log(filename);
  let index = 0;
  while (true) {
    const {name, ops: devOps, error: devError} = await delegateBench({filename, index, env: 'dev'});
    if (!name) break;
    const {ops: perfOps, error: perfError} = await delegateBench({filename, index, env: 'perf'});
    results[`${filename}/${name}`] = {dev: devOps, perf: perfOps};
    if (devError) errors.push(devError);
    if (perfError) errors.push(perfError);
    console.log(
      ' ',
      name.padEnd(15),
      (devError ? 'ERROR     ' : `${devOps.toLocaleString()} op/s`).padStart(OPS_WIDTH),
      (perfError ? 'ERROR     ' : `${perfOps.toLocaleString()} op/s`).padStart(OPS_WIDTH)
    );
    index += 1;
  }
}

console.log();
if (errors.length) {
  console.log('Errors:');
  for (const error of errors) console.log(error);
}


function delegateBench(workerData: any): Promise<{name?: string, ops: number, error?: string}> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_FILE, {workerData});
    worker.on('message', resolve);
    worker.on('error', reject);
  });
}
