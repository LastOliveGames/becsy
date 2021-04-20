import ms from 'ms';
import {performance} from 'perf_hooks';
import * as becsyDev from '../index';
import * as becsyPerf from '../perf';

const TARGET_RUNNING_TIME = ms('500ms');

const BENCHMARKS = [
  'ecs-benchmark'
];


const baseline = benchmark(runBaselineWorkload);
console.log('baseline', baseline, 'op/s');

console.log(' ', ' '.repeat(15), 'dev     '.padStart(12), 'perf     '.padStart(12));
for (const filename of BENCHMARKS) {
  console.log(filename);
  const module = await import(`./${filename}`);
  const devCases = module.default(becsyDev);
  const perfCases = module.default(becsyPerf);
  for (const caseName in devCases) {
    const devOps = runCase(devCases[caseName]);
    const perfOps = runCase(perfCases[caseName]);
    console.log(
      ' ',
      caseName.padEnd(15),
      `${devOps.toLocaleString()} op/s`.padStart(12),
      `${perfOps.toLocaleString()} op/s`.padStart(12)
    );
  }
}


function runCase(fn: () => becsyDev.World | becsyPerf.World): number {
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
  return Math.floor(targetCount / totalTime);
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
