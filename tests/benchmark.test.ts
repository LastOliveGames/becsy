import {Type} from '../src/type';
import {field} from '../src/decorators';
import {System} from '../src/system';
import {World} from '../src/world';

class A {
  @field.int32 declare value: number;
}

class B {
  @field.int32 declare value: number;
}

class C {
  @field.int32 declare value: number;
}

class D {
  @field.int32 declare value: number;
}

class E {
  @field.int32 declare value: number;
}

const COMPS = Array.from(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  () =>
    class {
      static schema: any = {
        value: Type.int32
      };
    }
);

class Data {
  @field.int32 declare value: number;
}


class SystemA extends System {
  entities = this.query(q => q.current.with(A).write);

  execute() {
    for (const entity of this.entities.current) {
      entity.write(A).value *= 2;
    }
  }
}

class SystemB extends System {
  entities = this.query(q => q.current.with(B).write);

  execute() {
    for (const entity of this.entities.current) {
      entity.write(B).value *= 2;
    }
  }
}

class SystemC extends System {
  entities = this.query(q => q.current.with(C).write);

  execute() {
    for (const entity of this.entities.current) {
      entity.write(C).value *= 2;
    }
  }
}

class SystemD extends System {
  entities = this.query(q => q.current.with(D).write);

  execute() {
    for (const entity of this.entities.current) {
      entity.write(D).value *= 2;
    }
  }
}

class SystemE extends System {
  entities = this.query(q => q.current.with(E).write);

  execute() {
    for (const entity of this.entities.current) {
      entity.write(E).value *= 2;
    }
  }
}

class AddB extends System {
  entities = this.query(q => q.current.with(A).but.without(B).write);

  execute() {
    for (const entity of this.entities.current) {
      entity.add(B);
    }
  }
}

class RemoveB extends System {
  sked = this.schedule(s => s.after(AddB));
  entities = this.query(q => q.current.with(B).write);

  execute() {
    for (const entity of this.entities.current) {
      entity.remove(B);
    }
  }
}

class SpawnB extends System {
  entities = this.query(q => q.current.with(A).also.using(B).write);

  execute() {
    for (const entity of this.entities.current) {
      const value = entity.read(A).value;
      this.createEntity(B, {value});
      this.createEntity(B, {value});
    }
  }
}

class KillB extends System {
  sked = this.schedule(s => s.after(SpawnB));
  entities = this.query(q => q.current.with(B).write);

  execute() {
    for (const entity of this.entities.current) {
      entity.delete();
    }
  }
}

class SystemAB extends System {
  entities = this.query(q => q.current.with(A).write.with(B).write);

  execute() {
    for (const entity of this.entities.current) {
      const a = entity.write(A);
      const b = entity.write(B);
      const x = a.value;
      a.value = b.value;
      b.value = x;
    }
  }
}

class SystemCD extends System {
  entities = this.query(q => q.current.with(C).write.with(D).write);

  execute() {
    for (const entity of this.entities.current) {
      const c = entity.write(C);
      const d = entity.write(D);
      const x = c.value;
      c.value = d.value;
      d.value = x;
    }
  }
}

class SystemCE extends System {
  sked = this.schedule(s => s.inAnyOrderWith(SystemCD));
  entities = this.query(q => q.current.with(C).write.with(E).write);

  execute() {
    for (const entity of this.entities.current) {
      const c = entity.write(C);
      const e = entity.write(E);
      const x = c.value;
      c.value = e.value;
      e.value = x;
    }
  }
}

class DataSystem extends System {
  entities = this.query(q => q.current.with(Data).write);

  execute() {
    for (const entity of this.entities.current) {
      entity.write(Data).value *= 2;
    }
  }
}

describe('benchmarks', () => {

  test('packed1', async() => {
    const count = 5000;
    const world = await World.create({
      maxEntities: count, maxShapeChangesPerFrame: count * 5 + 5, defaultComponentStorage: 'sparse',
      defs: [A, B, C, D, E, SystemA]
    });
    world.build(() => {
      for (let i = 0; i < count; i++) world.createEntity(A, B, C, D, E);
    });
    await world.execute();
  });

  test('packed5', async() => {
    const count = 1000;
    const world = await World.create({
      maxEntities: count, maxShapeChangesPerFrame: count * 5 + 5, defaultComponentStorage: 'sparse',
      defs: [A, B, C, D, E, SystemA, SystemB, SystemC, SystemD, SystemE]
    });
    world.build(() => {
      for (let i = 0; i < count; i++) world.createEntity(A, B, C, D, E);
    });
    await world.execute();
  });

  test('simpleIter', async() => {
    const count = 1000;
    const world = await World.create({
      maxEntities: count * 4, maxShapeChangesPerFrame: count * 13 + 5,
      defaultComponentStorage: 'sparse', defs: [A, B, C, D, E, SystemAB, SystemCD, SystemCE]
    });
    world.build(() => {
      for (let i = 0; i < count; i++) {
        world.createEntity(A, B, {value: 1});
        world.createEntity(A, B, {value: 1}, C, {value: 2});
        world.createEntity(A, B, {value: 1}, C, {value: 2}, D, {value: 3});
        world.createEntity(A, B, {value: 1}, C, {value: 2}, E, {value: 4});
      }
    });
    await world.execute();
  });

  test('fragIter', async() => {
    const count = 100;
    const world = await World.create({
      maxEntities: count * COMPS.length, maxShapeChangesPerFrame: count * 53,
      defaultComponentStorage: 'sparse', defs: [COMPS, Data, DataSystem]
    });
    world.build(() => {
      for (let i = 0; i < count; i++) {
        for (const Comp of COMPS) world.createEntity(Comp, Data);
      }
    });
    await world.execute();
  });

  test('entityCycle', async() => {
    const count = 1000;
    const world = await World.create({
      maxEntities: count * 8, maxLimboComponents: count * 8,
      defaultComponentStorage: 'sparse', defs: [A, B, SpawnB, KillB]
    });
    world.build(() => {
      for (let i = 0; i < count; i++) world.createEntity(A, {value: i});
    });
    await world.execute();
  });

  test('addRemove', async() => {
    const count = 1000;
    const world = await World.create({
      maxEntities: count, maxShapeChangesPerFrame: count * 2 + 2, maxLimboComponents: count * 2,
      defaultComponentStorage: 'sparse', defs: [A, B, AddB, RemoveB]
    });
    world.build(() => {
      for (let i = 0; i < count; i++) world.createEntity(A);
    });
    await world.execute();
  });

});

