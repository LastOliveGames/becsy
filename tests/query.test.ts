import {component, ComponentType, field, Query, System, SystemType, World} from '../src';


@component class A {
  @field.uint8 declare value: number;
}

@component class B {
  @field.uint8 declare value: number;
}

@component class C {
  @field.uint8 declare value: number;
}

@component class D {}

for (let i = 0; i < 30; i++) {
  @component class Foo { }  // eslint-disable-line @typescript-eslint/no-unused-vars
}

@component class E {
  @field.uint8 declare value: number;
}


class IncrementA extends System {
  sked = this.schedule(s => s.afterWritesTo(A));
  entities = this.query(q => q.current.with(A).write);
  execute() {
    for (const entity of this.entities.current) entity.write(A).value += 1;
  }
}

class IncrementC extends System {
  sked = this.schedule(s => s.afterWritesTo(C));
  entities = this.query(q => q.current.with(C).write);
  execute() {
    for (const entity of this.entities.current) entity.write(C).value += 1;
  }
}

class IncrementAC extends System {
  sked = this.schedule(s => s.afterWritesTo(A, C));
  entities = this.query(q => q.current.with(A, C).write);
  execute() {
    for (const entity of this.entities.current) {
      entity.write(A).value += 1;
      entity.write(C).value += 1;
    }
  }
}

class IncrementANotC extends System {
  sked = this.schedule(s => s.afterWritesTo(A));
  entities = this.query(q => q.current.with(A).write.but.without(C));
  execute() {
    for (const entity of this.entities.current) {
      entity.write(A).value += 1;
    }
  }
}

class IncrementAWithD extends System {
  sked = this.schedule(s => s.afterWritesTo(A));
  entities = this.query(q => q.current.with(A).write.with(D));
  execute() {
    for (const entity of this.entities.current) {
      entity.write(A).value += 1;
    }
  }
}

class AddCToA extends System {
  entities = this.query(q => q.current.with(A).write.and.using(C).write);
  execute() {
    for (const entity of this.entities.current) {
      if (!entity.has(C)) entity.add(C);
    }
  }
}

class RemoveCFromAC extends System {
  entities = this.query(q => q.current.with(A).and.with(C).write);
  execute() {
    for (const entity of this.entities.current) {
      entity.remove(C);
    }
  }
}

class CreateA extends System {
  entities = this.query(q => q.with(A).write);

  execute() {
    this.createEntity(A);
  }
}

class DeleteA extends System {
  entities = this.query(q => q.current.with(A).write.and.using(C).write);
  execute() {
    for (const entity of this.entities.current) {
      entity.delete();
    }
  }
}

class CreateAForEachC extends System {
  sked = this.schedule(s => s.before(DeleteA));
  entities = this.query(q => q.current.with(C).and.using(A).write);
  execute() {
    for (const entity of this.entities.current) {
      this.createEntity(A, {value: entity.read(C).value});
    }
  }
}

class DoNothing extends System {
  execute() {
    // do nothing
  }
}


let total: {[key: string]: number} = {a: 0, b: 0, c: 0, d: 0};

class Count extends System {
  private readonly items: {[key: string]: {type: ComponentType<any>, query: Query}} = {
    a: {type: A, query: this.query(q => q.current.with(A))},
    b: {type: B, query: this.query(q => q.current.with(B))},
    c: {type: C, query: this.query(q => q.current.with(C))},
    e: {type: E, query: this.query(q => q.current.with(E))}
  };

  execute() {
    total = {a: 0, b: 0, c: 0, e: 0};
    for (const key in this.items) {
      for (const entity of this.items[key].query.current) {
        total[key] += entity.read(this.items[key].type).value;
      }
    }
  }
}

async function createWorld(...systems: SystemType<System>[]): Promise<World> {
  return World.create({
    maxEntities: 100, defaultComponentStorage: 'sparse', defs: [systems, Count]
  });
}


describe('basic queries, current iteration, reads and writes', () => {

  test('iterate one type', async () => {
    const world = await createWorld(IncrementA);
    world.createEntity(A);
    world.createEntity(A);
    world.createEntity(A, C);
    world.createEntity(C);
    await world.execute();
    expect(total.a).toBe(3);
    expect(total.c).toBe(0);
  });

  test('iterate overlapping types', async () => {
    const world = await createWorld(IncrementA, IncrementC);
    world.createEntity(A);
    world.createEntity(A);
    world.createEntity(A, C);
    world.createEntity(C);
    await world.execute();
    expect(total.a).toBe(3);
    expect(total.c).toBe(2);
  });

  test('iterate type intersection', async () => {
    const world = await createWorld(IncrementAC);
    world.createEntity(A);
    world.createEntity(A);
    world.createEntity(A, C);
    world.createEntity(C);
    await world.execute();
    expect(total.a).toBe(1);
    expect(total.c).toBe(1);
  });

  test('iterate type intersection with tag type', async () => {
    const world = await createWorld(IncrementAWithD);
    world.createEntity(A);
    world.createEntity(A);
    world.createEntity(A, D);
    world.createEntity(D);
    await world.execute();
    expect(total.a).toBe(1);
  });

  test('iterate type exclusion', async () => {
    const world = await createWorld(IncrementANotC);
    world.createEntity(A);
    world.createEntity(A);
    world.createEntity(A, C);
    world.createEntity(C);
    await world.execute();
    expect(total.a).toBe(2);
    expect(total.c).toBe(0);
  });

  test('process system with no queries', async () => {
    const world = await createWorld(DoNothing);
    world.createEntity(A);
    await world.execute();
    world.createEntity(C);
    await world.execute();
    await world.execute();
  });
});

describe('component shape changes', () => {

  test('add a component for a subsequent system', async () => {
    const world = await createWorld(AddCToA, IncrementC);
    world.createEntity(A);
    world.createEntity(A);
    world.createEntity(A, C);
    await world.execute();
    expect(total.c).toBe(3);
  });

  test('remove a component for a subsequent system', async () => {
    const world = await createWorld(RemoveCFromAC, IncrementC);
    world.createEntity(C);
    world.createEntity(C);
    world.createEntity(A, C);
    await world.execute();
    expect(total.c).toBe(2);
  });

  test('iterate high numbered type', async () => {
    const world = await createWorld();
    world.createEntity(E, {value: 1});
    await world.execute();
    expect(total.e).toBe(1);
  });

});

describe('creating and deleting entities', () => {

  test('create entity for subsequent system', async () => {
    const world = await createWorld(CreateA, IncrementA);
    world.createEntity(A, C);
    await world.execute();
    expect(total.a).toBe(2);
    expect(total.c).toBe(0);
  });

  test('delete entity for subsequent system', async () => {
    const world = await createWorld(DeleteA, IncrementA, IncrementC);
    world.createEntity(A);
    world.createEntity(A);
    world.createEntity(A, C);
    world.createEntity(C);
    await world.execute();
    expect(total.a).toBe(0);
    expect(total.c).toBe(1);
  });

  test('recycle entity IDs', async () => {
    const world = await World.create({
      maxEntities: 9, maxLimboComponents: 12, defaultComponentStorage: 'sparse',
      defs: [CreateAForEachC, DeleteA]
    });
    world.createEntity(C, {value: 1});
    world.createEntity(C, {value: 2});
    world.createEntity(C, {value: 3});
    await world.execute();
    await world.execute();
    await world.execute();
    await world.execute();
  });

});

