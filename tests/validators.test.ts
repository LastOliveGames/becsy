/* eslint-disable @typescript-eslint/no-use-before-define */
import {component, World, type Entity, System} from '../src';

@component class A {
  static validate(entity: Entity): void {
    if (!entity.has(A)) return;
    if (!entity.hasSomeOf(B, C)) throw new Error('A missing B or C');
    if (entity.countHas(B, C) > 1) throw new Error('A has both B and C');
  }
}

@component class B {}

@component class C {
  static validate(entity: Entity): void {
    if (!entity.has(C)) return;
    if (entity.hasAllOf(C, D)) throw new Error('cannot share with D');
    if (entity.hasAnyOtherThan(C)) throw new Error('has other');
  }
}

@component class D {}

class E {
  static validate(entity: Entity): void {
    entity.read(E);
  }
}

class CreateInvalidEntityOnInitialize extends System {
  q = this.query(q => q.using(C, D).write);
  initialize() {
    this.createEntity(C, D);
  }
}

class CreateInvalidEntityOnExecute extends System {
  q = this.query(q => q.using(C).write);
  execute() {
    this.createEntity(C);
  }
}

class CreateInvalidEntityOnFinalize extends System {
  q = this.query(q => q.using(C).write);
  finalize() {
    this.createEntity(C);
  }
}

describe('run validators on entity creation', () => {
  test('create entity with no validation', async () => {
    const world = await World.create();
    world.createEntity(B);
  });

  test('create valid entity', async () => {
    const world = await World.create();
    world.createEntity(A, B);
  });

  test('create invalid entity directly', async () => {
    const world = await World.create();
    expect(() => world.createEntity(A)).toThrow('missing');
  });

  test('create invalid entity in world.build', async () => {
    const world = await World.create();
    expect(() => world.build(sys => {
      sys.createEntity(A, B, C);
    })).toThrow('has both');
  });

  test('create invalid entity in system initialize', async () => {
    await expect(World.create({defs: [CreateInvalidEntityOnInitialize]}))
      .rejects.toThrow('cannot share');
  });

  test('create invalid entity in system execute', async () => {
    const world = await World.create({defs: [CreateInvalidEntityOnExecute]});
    await expect(world.execute()).rejects.toThrow('has other');
  });

  test('create invalid entity in system finalize', async () => {
    const world = await World.create({defs: [CreateInvalidEntityOnFinalize]});
    await expect(world.terminate()).rejects.toThrow('has other');
  });
});

describe('run validators on shape change', () => {
  test('make invalid entity valid', async () => {
    const world = await World.create();
    world.build(sys => {
      const entity = sys.createEntity(A);
      entity.add(B);
    });
  });

  test('make valid entity invalid', async () => {
    const world = await World.create();
    expect(() => world.build(sys => {
      const entity = sys.createEntity(A, B);
      entity.remove(B);
    })).toThrow('missing');
  });
});

describe('run validators that use disallowed methods', () => {
  test('try to read a field', async () => {
    const world = await World.create({defs: [E]});
    expect(() => world.createEntity(E)).toThrow();
  });
});
