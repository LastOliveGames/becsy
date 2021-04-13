import {World, System, Type, Entity} from './index.js';
import {performance} from 'perf_hooks';


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
    entities: {all: Entity[]} = {all: []};

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
  const system = dispatcher.systems[0];

  for (let i = 0; i < count; i++) {
    world.createEntity(A);
    system.entities.all.push(dispatcher.registry.pool.borrow(i));
  }

  return () => {
    system.execute();
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
