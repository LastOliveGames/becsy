import {field, component, World, type Entity, type ComponentType} from '../src';

@component({storage: 'packed', initialCapacity: 2})
class PackedElastic {
  @field.int32 declare value: number;
}

@component({storage: 'packed', capacity: 2})
class PackedFixed {
  @field.int32 declare value: number;
}

@component({storage: 'compact', initialCapacity: 2})
class CompactElastic {
  @field.int32 declare value: number;
}

@component({storage: 'compact', capacity: 2})
class CompactFixed {
  @field.int32 declare value: number;
}


describe('using elastic packed component storage', () => {
  testFixed(PackedElastic);
  testElastic(PackedElastic);
});

describe('using fixed packed component storage', () => {
  testFixed(PackedFixed);
});

describe('using elastic compact component storage', () => {
  testFixed(CompactElastic);
  testElastic(CompactElastic);
});

describe('using fixed compact component storage', () => {
  testFixed(CompactFixed);
});


function testFixed(Component: ComponentType<any>): void {
  test('store and read values', async () => {
    const world = await World.create();
    world.build(system => {
      const entity1 = system.createEntity(Component, {value: 1});
      const entity2 = system.createEntity(Component, {value: 2});
      expect(entity1.read(Component).value).toBe(1);
      expect(entity2.read(Component).value).toBe(2);
      expect(world.stats.forComponent(Component).numEntities).toBe(2);
    });
  });

  test('reuse spare slots', async () => {
    const world = await World.create();
    world.build(system => {
      const entity1 = system.createEntity(Component, {value: 1});
      const entity2 = system.createEntity(Component, {value: 2});
      entity1.remove(Component);
      expect(entity1.has(Component)).toBe(false);
      expect(entity2.read(Component).value).toBe(2);
      expect(world.stats.forComponent(Component).numEntities).toBe(1);
      expect(world.stats.forComponent(Component).maxEntities).toBe(2);
    });
    // flush out the removed component
    await world.execute();
    await world.execute();
    world.build(system => {
      const entity3 = system.createEntity(Component, {value: 3});
      expect(entity3.read(Component).value).toBe(3);
      expect(world.stats.forComponent(Component).numEntities).toBe(2);
      expect(world.stats.forComponent(Component).maxEntities).toBe(2);
      expect(world.stats.forComponent(Component).capacity).toBe(2);
    });
  });

  test('access removed components', async () => {
    const world = await World.create();
    world.build(system => {
      const entity1 = system.createEntity(Component, {value: 1});
      entity1.remove(Component);
      system.createEntity(Component, {value: 2});
      expect(entity1.has(Component)).toBe(false);
      system.accessRecentlyDeletedData(true);
      expect(entity1.has(Component)).toBe(true);
      expect(entity1.read(Component).value).toBe(1);
    });
  });

  test('resurrect components', async () => {
    const world = await World.create();
    let entity1: Entity;
    world.build(system => {
      entity1 = system.createEntity(Component, {value: 1}).hold();
      entity1.remove(Component);
      entity1.add(Component, {value: 2});
    });
    await world.execute();
    await world.execute();
    expect(entity1!.has(Component)).toBe(true);
    expect(entity1!.read(Component).value).toBe(2);
  });
}

function testElastic(Component: ComponentType<any>): void {
  test('expand capacity', async () => {
    const world = await World.create();
    world.build(system => {
      const entity1 = system.createEntity(Component, {value: 1});
      const entity2 = system.createEntity(Component, {value: 2});
      expect(world.stats.forComponent(Component).capacity).toBe(2);
      const entity3 = system.createEntity(Component, {value: 3});
      expect(world.stats.forComponent(Component).capacity).toBeGreaterThan(2);
      expect(entity1.read(Component).value).toBe(1);
      expect(entity2.read(Component).value).toBe(2);
      expect(entity3.read(Component).value).toBe(3);
      expect(world.stats.forComponent(Component).numEntities).toBe(3);
    });
  });

  test('grow spares list', async () => {
    const world = await World.create();
    world.build(system => {
      const entities = [];
      for (let i = 0; i < 9; i++) entities[i] = system.createEntity(Component);
      expect(world.stats.forComponent(Component).numEntities).toBe(9);
      expect(world.stats.forComponent(Component).capacity).toBe(16);
      for (let i = 0; i < 9; i++) entities[i].remove(Component);
      expect(world.stats.forComponent(Component).numEntities).toBe(0);
      for (let i = 0; i < 9; i++) entities[i].add(Component);
      expect(world.stats.forComponent(Component).numEntities).toBe(9);
      expect(world.stats.forComponent(Component).capacity).toBe(16);
      system.createEntity(Component);
      expect(world.stats.forComponent(Component).numEntities).toBe(10);
    });
  });

  test('switch to bigger array type', async () => {
    const world = await World.create();
    world.build(system => {
      for (let i = 0; i < 128; i++) system.createEntity(Component);
      expect(world.stats.forComponent(Component).capacity).toBe(128);
    });
  });
}
