import {Component, config, prop, System, Type, World} from '../src';
import {profile} from '../src/profile';
import {performance} from 'perf_hooks';

config.DEBUG = false;

class A extends Component {
  @prop(Type.int32) declare value: number;
}

class B extends Component {
  static schema = {
    value: Type.int32
  };
}

class C extends Component {
  static schema = {
    value: Type.int32
  };
}

class D extends Component {
  static schema = {
    value: Type.int32
  };
}

class E extends Component {
  static schema = {
    value: Type.int32
  };
}

class ASystem extends System {
  entities = this.query(q => q.with(A).write);

  execute() {
    for (const entity of this.entities.all) {
      entity.write(A).value *= 2;
    }
  }
}

let world: World;

function setup(count: number) {
  world = new World({
    maxEntities: count,
    componentTypes: [A, B, C, D, E],
    systems: [ASystem]
  });

  for (let i = 0; i < count; i++) {
    world.createEntity(A, {value: 0}, B, {value: 0}, C, {value: 0}, D, {value: 0}, E, {value: 0});
  }
}

function run(count: number) {
  for (let i = 0; i < count; i++) world.execute();
}

const PROFILE_SETUP = 0;
const PROFILE_RUN = 0;
const SIZE = 5000;
const RUNS = 5000;

console.log('setup');
if (PROFILE_SETUP) await profile(async() => setup(SIZE)); else setup(SIZE);
console.log('run');
const start = performance.now();
if (PROFILE_RUN) await profile(async() => run(RUNS)); else run(RUNS);
const end = performance.now();
const ops = Math.round(RUNS / (end - start) * 1000);
console.log(`done in ${Math.round(end - start)}ms, ${ops} ops/s`);
