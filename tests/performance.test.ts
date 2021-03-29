import {config, prop, System, Type, World} from '../src';
import {profile} from '../src/profile';
import {performance} from 'perf_hooks';

config.DEBUG = true;

class A {
  @prop(Type.int32) declare value: number;
}

class B {
  @prop(Type.int32) declare value: number;
}

class C {
  @prop(Type.int32) declare value: number;
}

class D {
  @prop(Type.int32) declare value: number;
}

class E {
  @prop(Type.int32) declare value: number;
}

class SystemA extends System {
  entities = this.query(q => q.all.with(A).write);

  execute() {
    for (const entity of this.entities.all) {
      entity.write(A).value *= 2;
    }
  }
}

class SystemB extends System {
  entities = this.query(q => q.all.with(B).write);

  execute() {
    for (const entity of this.entities.all) {
      entity.write(B).value *= 2;
    }
  }
}

class SystemC extends System {
  entities = this.query(q => q.all.with(C).write);

  execute() {
    for (const entity of this.entities.all) {
      entity.write(C).value *= 2;
    }
  }
}

class SystemD extends System {
  entities = this.query(q => q.all.with(D).write);

  execute() {
    for (const entity of this.entities.all) {
      entity.write(D).value *= 2;
    }
  }
}

class SystemE extends System {
  entities = this.query(q => q.all.with(E).write);

  execute() {
    for (const entity of this.entities.all) {
      entity.write(E).value *= 2;
    }
  }
}

class AddB extends System {
  entities = this.query(q => q.all.with(A).but.without(B).write);

  execute() {
    for (const entity of this.entities.all) {
      entity.add(B, {value: 0});
    }
  }
}

class RemoveB extends System {
  entities = this.query(q => q.all.with(B).write);

  execute() {
    for (const entity of this.entities.all) {
      entity.remove(B);
    }
  }
}

class SpawnB extends System {
  entities = this.query(q => q.all.with(A).also.using(B).write);

  execute() {
    for (const entity of this.entities.all) {
      const value = entity.read(A).value;
      this.createEntity(B, {value});
      this.createEntity(B, {value});
    }
  }
}

class KillB extends System {
  entities = this.query(q => q.all.with(B).write);

  execute() {
    for (const entity of this.entities.all) {
      entity.delete();
    }
  }
}

class ABSystem extends System {
  entities = this.query(q => q.all.with(A).write.with(B).write);

  execute() {
    for (const entity of this.entities.all) {
      const a = entity.write(A);
      const b = entity.write(B);
      const x = a.value;
      a.value = b.value;
      b.value = x;
    }
  }
}

class CDSystem extends System {
  entities = this.query(q => q.all.with(C).write.with(D).write);

  execute() {
    for (const entity of this.entities.all) {
      const c = entity.write(C);
      const d = entity.write(D);
      const x = c.value;
      c.value = d.value;
      d.value = x;
    }
  }
}

class CESystem extends System {
  entities = this.query(q => q.all.with(C).write.with(E).write);

  execute() {
    for (const entity of this.entities.all) {
      const c = entity.write(C);
      const e = entity.write(E);
      const x = c.value;
      c.value = e.value;
      e.value = x;
    }
  }
}


function setup(count: number): World {
  const world = new World({
    maxEntities: count * 5,
    maxLimboEntities: count * 4,
    maxShapeChangesPerFrame: count * 5,
    componentTypes: [A, B, C, D, E],
    // systems: [SystemA]
    // systems: [SystemA, SystemB, SystemC, SystemD, SystemE]
    // systems: [ABSystem, CDSystem, CESystem]
    // systems: [AddB, RemoveB]
    systems: [SpawnB, KillB]
  });

  for (let i = 0; i < count; i++) {
    // world.createEntity(A, {value: 0}, B, {value: 0}, C, {value: 0}, D, {value: 0}, E, {value: 0});
    world.createEntity(A, {value: i});
  }

  return world;
}

let world: World;

function run(count: number) {
  for (let i = 0; i < count; i++) world.execute();
}

const PROFILE_SETUP = 0;
const PROFILE_RUN = 0;
const SIZE = 1000;
const RUNS = 1000;

console.log('setup');
if (PROFILE_SETUP) world = await profile(async() => setup(SIZE)); else world = setup(SIZE);
console.log('run');
const start = performance.now();
if (PROFILE_RUN) await profile(async() => run(RUNS)); else run(RUNS);
console.log(world.stats.toString());
const end = performance.now();
const ops = Math.round(RUNS / (end - start) * 1000);
console.log(`done in ${Math.round(end - start)}ms, ${ops} ops/s`);
