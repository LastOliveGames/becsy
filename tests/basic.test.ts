import {
  component, ComponentType, componentTypes, Entity, prop, TopQuery, System, SystemType, Type, World,
  config
} from '../src';

config.DEBUG = true;


@component class A {
  @prop(Type.uint8) declare value: number;
}

@component class B {
  @prop(Type.ref) declare a: Entity;
  @prop(Type.uint8) declare value: number;
}

@component class C {
  @prop(Type.uint8) declare value: number;
}


class IncrementA extends System {
  entities = this.query(q => q.all.with(A).write);
  execute() {
    for (const entity of this.entities.all) entity.write(A).value += 1;
  }
}

class IncrementC extends System {
  entities = this.query(q => q.all.with(C).write);
  execute() {
    for (const entity of this.entities.all) entity.write(C).value += 1;
  }
}

class IncrementAC extends System {
  entities = this.query(q => q.all.with(A, C).write);
  execute() {
    for (const entity of this.entities.all) {
      entity.write(A).value += 1;
      entity.write(C).value += 1;
    }
  }
}

class IncrementANotC extends System {
  entities = this.query(q => q.all.with(A).write.but.without(C));
  execute() {
    for (const entity of this.entities.all) {
      entity.write(A).value += 1;
    }
  }
}

class AddCToA extends System {
  entities = this.query(q => q.all.with(A).write.and.using(C).write);
  execute() {
    for (const entity of this.entities.all) {
      if (!entity.has(C)) entity.add(C);
    }
  }
}

class RemoveCFromAC extends System {
  entities = this.query(q => q.all.with(A).and.with(C).write);
  execute() {
    for (const entity of this.entities.all) {
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
  entities = this.query(q => q.all.with(A).write.and.using(C).write);
  execute() {
    for (const entity of this.entities.all) {
      entity.delete();
    }
  }
}

class CreateAForEachC extends System {
  entities = this.query(q => q.all.with(C).and.using(A).write);
  execute() {
    for (const entity of this.entities.all) {
      this.createEntity(A, {value: entity.read(C).value});
    }
  }
}

class DoubleARefsFromB extends System {
  entities = this.query(q => q.all.with(B).and.using(A).write);
  execute() {
    for (const entity of this.entities.all) {
      const ref = entity.read(B).a;
      if (ref) ref.write(A).value *= 2;
    }
  }
}

class IncrementBReferringToA extends System {
  entities = this.query(q => q.with(A).join('bs', j => j.with(B).write.ref('a')));
  execute() {
    for (const entity of this.entities.all) {
      for (const referrer of entity.joined.bs) {
        referrer.write(B).value += 1;
      }
    }
  }
}

let total: {[key: string]: number} = {a: 0, b: 0, c: 0};

class Count extends System {
  private readonly items: {[key: string]: {type: ComponentType<any>, query: TopQuery}} = {
    a: {type: A, query: this.query(q => q.all.with(A))},
    b: {type: B, query: this.query(q => q.all.with(B))},
    c: {type: C, query: this.query(q => q.all.with(C))}
  };

  execute() {
    total = {a: 0, b: 0, c: 0};
    for (const key in this.items) {
      for (const entity of this.items[key].query.all) {
        total[key] += entity.read(this.items[key].type).value;
      }
    }
  }
}

function createWorld(...systems: SystemType[]): World {
  return new World({maxEntities: 100, componentTypes, systems: [systems, Count]});
}


describe('basic queries, all iteration, reads and writes', () => {

  test('iterate one type', () => {
    const world = createWorld(IncrementA);
    world.createEntity(A);
    world.createEntity(A);
    world.createEntity(A, C);
    world.createEntity(C);
    world.execute();
    expect(total.a).toBe(3);
    expect(total.c).toBe(0);
  });

  test('iterate overlapping types', () => {
    const world = createWorld(IncrementA, IncrementC);
    world.createEntity(A);
    world.createEntity(A);
    world.createEntity(A, C);
    world.createEntity(C);
    world.execute();
    expect(total.a).toBe(3);
    expect(total.c).toBe(2);
  });

  test('iterate type intersection', () => {
    const world = createWorld(IncrementAC);
    world.createEntity(A);
    world.createEntity(A);
    world.createEntity(A, C);
    world.createEntity(C);
    world.execute();
    expect(total.a).toBe(1);
    expect(total.c).toBe(1);
  });

  test('iterate type exclusion', () => {
    const world = createWorld(IncrementANotC);
    world.createEntity(A);
    world.createEntity(A);
    world.createEntity(A, C);
    world.createEntity(C);
    world.execute();
    expect(total.a).toBe(2);
    expect(total.c).toBe(0);
  });
});

describe('component shape changes', () => {

  test('add a component for a subsequent system', () => {
    const world = createWorld(AddCToA, IncrementC);
    world.createEntity(A);
    world.createEntity(A);
    world.createEntity(A, C);
    world.execute();
    expect(total.c).toBe(3);
  });

  test('remove a component for a subsequent system', () => {
    const world = createWorld(RemoveCFromAC, IncrementC);
    world.createEntity(C);
    world.createEntity(C);
    world.createEntity(A, C);
    world.execute();
    expect(total.c).toBe(2);
  });

});

describe('creating and deleting entities', () => {

  test('create entity for subsequent system', () => {
    const world = createWorld(CreateA, IncrementA);
    world.createEntity(A, C);
    world.execute();
    expect(total.a).toBe(2);
    expect(total.c).toBe(0);
  });

  test('delete entity for subsequent system', () => {
    const world = createWorld(DeleteA, IncrementA, IncrementC);
    world.createEntity(A);
    world.createEntity(A);
    world.createEntity(A, C);
    world.createEntity(C);
    world.execute();
    expect(total.a).toBe(0);
    expect(total.c).toBe(1);
  });

  test('recycle entity IDs', () => {
    const world = new World({
      maxEntities: 9, maxLimboEntities: 7, componentTypes, systems: [CreateAForEachC, DeleteA]
    });
    world.createEntity(C, {value: 1});
    world.createEntity(C, {value: 2});
    world.createEntity(C, {value: 3});
    world.execute();
    world.execute();
    world.execute();
    world.execute();
  });
});

describe('references', () => {

  test('follow refs', () => {
    const world = createWorld(DoubleARefsFromB);
    world.build(sys => {
      sys.createEntity(A, {value: 5});
      const a = sys.createEntity(A, {value: 1});
      sys.createEntity(B, {a});
      sys.createEntity(B);
    });
    world.execute();
    expect(total.a).toBe(7);
  });

  test.skip('join refs', () => {
    const world = createWorld(IncrementBReferringToA);
    world.build(sys => {
      sys.createEntity(A, {value: 5});
      const a = sys.createEntity(A, {value: 1});
      sys.createEntity(B, {a});
      sys.createEntity(B);
    });
    world.execute();
    expect(total.b).toBe(1);
  });
});

