import {prop, component, Type, World, Entity} from '../src';

@component({storage: 'packed', initialCapacity: 2})
class A {
  @prop(Type.int32) declare value: number;
}

describe('using packed component storage', () => {

  test('store and read values', () => {
    const world = new World({defs: [A]});
    world.build(system => {
      const entity1 = system.createEntity(A, {value: 1});
      const entity2 = system.createEntity(A, {value: 2});
      expect(entity1.read(A).value).toBe(1);
      expect(entity2.read(A).value).toBe(2);
      expect(world.stats.for(A).numEntities).toBe(2);
    });
  });

  test('expand capacity', () => {
    const world = new World({defs: [A]});
    world.build(system => {
      const entity1 = system.createEntity(A, {value: 1});
      const entity2 = system.createEntity(A, {value: 2});
      expect(world.stats.for(A).capacity).toBe(2);
      const entity3 = system.createEntity(A, {value: 3});
      expect(world.stats.for(A).capacity).toBeGreaterThan(2);
      expect(entity1.read(A).value).toBe(1);
      expect(entity2.read(A).value).toBe(2);
      expect(entity3.read(A).value).toBe(3);
      expect(world.stats.for(A).numEntities).toBe(3);
    });
  });

  test('reuse spare slots', () => {
    const world = new World({defs: [A]});
    world.build(system => {
      const entity1 = system.createEntity(A, {value: 1});
      const entity2 = system.createEntity(A, {value: 2});
      entity1.remove(A);
      expect(entity1.has(A)).toBe(false);
      expect(entity2.read(A).value).toBe(2);
      expect(world.stats.for(A).numEntities).toBe(1);
      expect(world.stats.for(A).maxEntities).toBe(2);
    });
    // flush out the removed component
    world.execute();
    world.execute();
    world.build(system => {
      const entity3 = system.createEntity(A, {value: 3});
      expect(entity3.read(A).value).toBe(3);
      expect(world.stats.for(A).numEntities).toBe(2);
      expect(world.stats.for(A).maxEntities).toBe(2);
      expect(world.stats.for(A).capacity).toBe(2);
    });
  });

  test('grow spares list', () => {
    const world = new World({defs: [A]});
    world.build(system => {
      const entities = [];
      for (let i = 0; i < 9; i++) entities[i] = system.createEntity(A);
      expect(world.stats.for(A).numEntities).toBe(9);
      expect(world.stats.for(A).capacity).toBe(16);
      for (let i = 0; i < 9; i++) entities[i].remove(A);
      expect(world.stats.for(A).numEntities).toBe(0);
      for (let i = 0; i < 9; i++) entities[i].add(A);
      expect(world.stats.for(A).numEntities).toBe(9);
      expect(world.stats.for(A).capacity).toBe(16);
      system.createEntity(A);
      expect(world.stats.for(A).numEntities).toBe(10);
    });
  });

  test('access removed components', () => {
    const world = new World({defs: [A]});
    world.build(system => {
      const entity1 = system.createEntity(A, {value: 1});
      entity1.remove(A);
      system.createEntity(A, {value: 2});
      expect(entity1.has(A, true)).toBe(true);
      expect(entity1.readRecentlyRemoved(A).value).toBe(1);
    });
  });

  test('resurrect components', () => {
    const world = new World({defs: [A]});
    let entity1: Entity;  // will be released, but there's nothing to overwrite it
    world.build(system => {
      entity1 = system.createEntity(A, {value: 1});
      entity1.remove(A);
      entity1.add(A, {value: 2});
    });
    world.execute();
    world.execute();
    expect(entity1!.has(A)).toBe(true);
    expect(entity1!.read(A).value).toBe(2);
  });

  test('switch to bigger array type', () => {
    const world = new World({defs: [A]});
    world.build(system => {
      for (let i = 0; i < 128; i++) system.createEntity(A);
      expect(world.stats.for(A).capacity).toBe(128);
    });
  });
});
