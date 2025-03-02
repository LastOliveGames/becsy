import {performance} from 'perf_hooks';
import {parentPort, workerData} from 'worker_threads';

const TARGET_RUNNING_TIME = 500;  // ms

if (workerData.baseline) {
  const ops = await benchmark(runBaselineWorkload);
  parentPort!.postMessage({name: 'baseline', ops});
}

const becsy = await import(workerData.env === 'dev' ? '../index.js' : '../perf.js');
const module = await import(`./${workerData.filename}.js`);
const tests = module.default(becsy);
let index = 0;
for (const name in tests) {
  if (index++ === workerData.index) {
    try {
      const ops = await runCase(tests[name]);
      parentPort!.postMessage({name, ops});
    } catch (e: any) {
      parentPort!.postMessage({name, ops: 0, error: e.toString()});
    }
    break;
  }
}
parentPort!.postMessage({ops: 0});

async function runCase(fn: () => Promise<any>): Promise<number> {
  const world = await fn();
  return benchmark(() => world.execute());
}

async function benchmark(fn: () => Promise<void>): Promise<number> {
  let cycleTime = 0;
  let cycleTotalTime = 0;
  let cycleCount = 1;
  while (cycleTotalTime < TARGET_RUNNING_TIME) {
    const elapsed = await time(fn, cycleCount);
    cycleTime = elapsed / cycleCount;
    cycleCount *= 2;
    cycleTotalTime += elapsed;
  }

  global.gc!();
  const targetCount = Math.ceil(TARGET_RUNNING_TIME / cycleTime);
  const totalTime = await time(fn, targetCount);
  return Math.floor(targetCount / totalTime * 1000);
}

async function time(fn: () => Promise<void>, count: number): Promise<number> {
  const start = performance.now();
  for (let i = 0; i < count; i++) await fn();
  const end = performance.now();
  return end - start;
}

async function runBaselineWorkload(): Promise<void> {
  let n = 1;
  for (let i = 0; i < 50000; i++) {
    n += 1;
  }
  if (n < 1) console.log('BOGUS');
}
