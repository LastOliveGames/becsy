import {performance} from 'perf_hooks';
import {parentPort, workerData} from 'worker_threads';

const TARGET_RUNNING_TIME = 500;  // ms

if (workerData.baseline) {
  const ops = benchmark(runBaselineWorkload);
  parentPort!.postMessage({name: 'baseline', ops});
}

const becsy = await import(workerData.env === 'dev' ? '../index' : '../perf');
const module = await import(`./${workerData.filename}`);
const tests = module.default(becsy);
let index = 0;
for (const name in tests) {
  if (index++ === workerData.index) {
    try {
      const ops = runCase(tests[name]);
      parentPort!.postMessage({name, ops});
    } catch (e) {
      parentPort!.postMessage({name, ops: 0, error: e.toString()});
    }
    break;
  }
}
parentPort!.postMessage({ops: 0});

function runCase(fn: () => any): number {
  const world = fn();
  return benchmark(() => {world.execute();});
}

function benchmark(fn: () => void): number {
  let cycleTime = 0;
  let cycleTotalTime = 0;
  let cycleCount = 1;
  while (cycleTotalTime < TARGET_RUNNING_TIME) {
    const elapsed = time(fn, cycleCount);
    cycleTime = elapsed / cycleCount;
    cycleCount *= 2;
    cycleTotalTime += elapsed;
  }

  global.gc();
  const targetCount = Math.ceil(TARGET_RUNNING_TIME / cycleTime);
  const totalTime = time(fn, targetCount);
  return Math.floor(targetCount / totalTime * 1000);
}

function time(fn: () => void, count: number): number {
  const start = performance.now();
  for (let i = 0; i < count; i++) fn();
  const end = performance.now();
  return end - start;
}

function runBaselineWorkload(): void {
  let n = 1;
  for (let i = 0; i < 50000; i++) {
    n += 1;
  }
  if (n < 1) console.log('BOGUS');
}
