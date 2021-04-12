import {System, Type} from '../src';
import {performance} from 'perf_hooks';
import {ComponentType, decorateComponentType} from '../src/component';


function setup(count: number): () => void {
  const entities = [];
  // const aIndex = new Int32Array(new SharedArrayBuffer(count * 4));
  // const aValue = new Int32Array(new SharedArrayBuffer(count * 4));


  class A {
    // static instance = new A();
    declare value: number;
    static schema = {
      value: Type.int32
    };
  }
  // Object.defineProperty(A.prototype, 'value', {
  //   get() {return aValue[this.id];},
  //   set(x) {if (!this.mutable) throw new Error('not mutable'); aValue[this.id] = x;}
  // });
  decorateComponentType(1, A, {maxEntities: 5000} as any);

  class Entity {
    constructor(readonly id: number) {}

    write<C>(type: ComponentType<C>): C {
      return type.__bind!(this.id, true);
    }

    read<C>(type: ComponentType<C>): C {
      return type.__bind!(this.id, false);
    }
  }


  for (let i = 0; i < count; i++) {
    entities[i] = new Entity(i);
    // aIndex[i] = i;
  }

  class SystemA extends System {
    entities: {all: Entity[]} = {all: []};

    execute() {
      for (const entity of this.entities.all) {
        entity.write(A).value *= 2;
      }
    }
  }


  // const dispatcher = new Dispatcher(count, [SystemA]);
  // const world = new World();
  // world.dispatcher = dispatcher;
  // const system = dispatcher.systems[0];
  // system.__dispatcher = dispatcher;
  // system.entities.__system = system;
  // system.entities.__init();

  const system = new SystemA();
  for (const entity of entities) system.entities.all.push(entity);

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
