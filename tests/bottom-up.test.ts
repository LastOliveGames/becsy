import {World, System, Type} from './index.js';
import {performance} from 'perf_hooks';

const now = typeof window !== 'undefined' && typeof window.performance !== 'undefined' ?
  performance.now.bind(performance) : Date.now.bind(Date);

function setup(count: number): () => void {
  class A {
    declare value: number;
    static schema = {
      value: Type.int32
    };
  }

  class B {
    declare value: number;
    static schema = {
      value: Type.int32
    };
  }

  class C {
    declare value: number;
    static schema = {
      value: Type.int32
    };
  }

  class D {
    declare value: number;
    static schema = {
      value: Type.int32
    };
  }

  class E {
    declare value: number;
    static schema = {
      value: Type.int32
    };
  }


  class SystemA extends System {
    entities = this.query(q => q.all.with(A).write);

    execute() {
      for (const entity of this.entities.all) {
        entity.write(A).value *= 2;
      }
    }
  }


  const world = new World({
    maxEntities: count, componentTypes: [A, B, C, D, E], systems: [SystemA]
  });
  const dispatcher = (world as any).__dispatcher;

  for (let i = 0; i < count; i++) {
    world.createEntity(A);
  }
  world.execute();

  return () => {
    let time, delta;
    dispatcher.executing = true;
    if (time === undefined) time = now() / 1000;
    if (delta === undefined) delta = time - dispatcher.lastTime;
    dispatcher.lastTime = time;
    for (const system of dispatcher.systems) {
      dispatcher.registry.executingSystem = system;
      system.time = time;
      system.delta = delta;
      // for (const query of system.__queries) query.__execute();
      system.__queries[0].__execute();
      system.execute();
      dispatcher.flush();
    }
    dispatcher.registry.executingSystem = undefined;
    dispatcher.registry.processEndOfFrame();
    dispatcher.executing = false;
  };
}


const SIZE = 5000;
const RUNS = 40000;

console.log('setup');
const run = setup(SIZE);
console.log('run');
const start = performance.now();
for (let i = 0; i < RUNS; i++) run();
const end = performance.now();
const ops = Math.round(RUNS / (end - start) * 1000);
console.log(`done in ${Math.round(end - start)}ms, ${ops} ops/s`);
