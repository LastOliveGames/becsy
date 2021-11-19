import {component, ComponentType, Entity, field, Query, System, SystemType, World} from '../src';


@component class Origin {
  @field.uint8 declare value: number;
  @field.ref declare target?: Entity;
}

@component class MultiOrigin {
  @field.uint8 declare value: number;
  @field.ref declare target1?: Entity;
  @field.ref declare target2?: Entity;
}

@component class PreciseDest {
  @field.uint8 declare value: number;
  @field.backrefs(MultiOrigin, 'target1') declare targeters: Entity[];
}

@component class TypeDest {
  @field.uint8 declare value: number;
  @field.backrefs(MultiOrigin) declare targeters: Entity[];
}

@component class GlobalDest {
  @field.uint8 declare value: number;
  @field.backrefs declare targeters: Entity[];
}

@component class GlobalDestWithStales {
  @field.uint8 declare value: number;
  @field.backrefs(undefined, undefined, true) declare targeters: Entity[];
}

const componentTypes =
  [Origin, MultiOrigin, PreciseDest, TypeDest, GlobalDest, GlobalDestWithStales];


class IncrementTargetedDests extends System {
  originEntities = this.query(q =>
    q.current.with(Origin).and.using(PreciseDest, TypeDest, GlobalDest).write);

  multiOriginEntities = this.query(q =>
    q.current.with(MultiOrigin).and.using(PreciseDest, TypeDest, GlobalDest).write);

  execute() {
    for (const entity of this.originEntities.current) {
      this.processTarget(entity.read(Origin).target);
    }
    for (const entity of this.multiOriginEntities.current) {
      this.processTarget(entity.read(MultiOrigin).target1);
      this.processTarget(entity.read(MultiOrigin).target2);
    }
  }

  private processTarget(ref?: Entity): void {
    if (!ref) return;
    if (ref.has(PreciseDest)) ref.write(PreciseDest).value += 1;
    if (ref.has(TypeDest)) ref.write(TypeDest).value += 1;
    if (ref.has(GlobalDest)) ref.write(GlobalDest).value += 1;
  }
}

class IncrementTargeters extends System {
  preciseEntities = this.query(
    q => q.current.with(PreciseDest).and.using(Origin, MultiOrigin).write);

  typeEntities = this.query(q => q.current.with(TypeDest).and.using(Origin, MultiOrigin).write);
  globalEntities = this.query(q => q.current.with(GlobalDest).and.using(Origin, MultiOrigin).write);

  execute() {
    for (const entity of this.preciseEntities.current) {
      this.processTargeters(entity.read(PreciseDest).targeters);
    }
    for (const entity of this.typeEntities.current) {
      this.processTargeters(entity.read(TypeDest).targeters);
    }
    for (const entity of this.globalEntities.current) {
      this.processTargeters(entity.read(GlobalDest).targeters);
    }
  }

  private processTargeters(targeters: Entity[]): void {
    for (const targeter of targeters) {
      if (targeter.has(Origin)) targeter.write(Origin).value += 1;
      if (targeter.has(MultiOrigin)) targeter.write(MultiOrigin).value += 1;
    }
  }
}


let total: {[key: string]: number};

class Count extends System {
  private readonly items: {[key: string]: {type: ComponentType<any>, query: Query}} =
    Object.fromEntries(componentTypes.map(type => [
      type.name[0].toLowerCase() + type.name.substring(1),
      {type, query: this.query(q => q.current.with(type))}
    ]));

  execute() {
    total = Object.fromEntries(Object.keys(this.items).map(key => [key, 0]));
    for (const key in this.items) {
      for (const entity of this.items[key].query.current) {
        total[key] += entity.read(this.items[key].type).value;
      }
    }
  }
}

async function createWorld(...systems: SystemType<System>[]): Promise<World> {
  return World.create({
    maxEntities: 200, defaultComponentStorage: 'sparse', defs: [systems, Count]
  });
}


describe('follow forward references', () => {

  test('refs', async () => {
    const world = await createWorld(IncrementTargetedDests);
    world.build(sys => {
      sys.createEntity(PreciseDest);
      const d1 = sys.createEntity(PreciseDest);
      const d2 = sys.createEntity(PreciseDest);
      const d3 = sys.createEntity(PreciseDest);
      sys.createEntity(Origin, MultiOrigin);
      sys.createEntity(Origin, {target: d1}, MultiOrigin, {target1: d2, target2: d3});
    });
    await world.execute();
    expect(total.preciseDest).toBe(3);
  });

  test('refs in recently removed component', async () => {
    const world = await createWorld();
    world.build(sys => {
      const d1 = sys.createEntity(PreciseDest);
      const o = sys.createEntity(Origin, {target: d1});
      o.remove(Origin);
      expect(o.has(Origin)).toBe(false);
      sys.accessRecentlyDeletedData();
      expect(o.read(Origin).target).toBe(d1);
    });
  });

  test('reassigned refs', async () => {
    const world = await createWorld();
    let d1: Entity, d2: Entity, o: Entity;
    world.build(sys => {
      d1 = sys.createEntity(PreciseDest).hold();
      d2 = sys.createEntity(PreciseDest).hold();
      o = sys.createEntity(Origin, {target: d1}).hold();
      o!.write(Origin).target = d2;
      o!.write(Origin).target = d1;
    });
  });

});

describe('follow backward references', () => {

  test('precise backref', async () => {
    const world = await createWorld(IncrementTargeters);
    world.build(sys => {
      sys.createEntity(PreciseDest);
      const d1 = sys.createEntity(PreciseDest);
      const d2 = sys.createEntity(PreciseDest);
      sys.createEntity(MultiOrigin, {target1: d1, target2: d2});
      sys.createEntity(MultiOrigin);
      sys.createEntity(Origin, {target: d1});
      sys.createEntity(Origin, {target: d2});
    });
    await world.execute();
    expect(total.multiOrigin).toBe(1);
    expect(total.origin).toBe(0);
  });

  test('type backref', async () => {
    const world = await createWorld(IncrementTargeters);
    world.build(sys => {
      sys.createEntity(TypeDest);
      const d1 = sys.createEntity(TypeDest);
      const d2 = sys.createEntity(TypeDest);
      sys.createEntity(MultiOrigin, {target1: d1, target2: d2});
      sys.createEntity(MultiOrigin);
      sys.createEntity(Origin, {target: d1});
      sys.createEntity(Origin, {target: d2});
    });
    await world.execute();
    expect(total.multiOrigin).toBe(2);
    expect(total.origin).toBe(0);
  });

  test('global backref', async () => {
    const world = await createWorld(IncrementTargeters);
    world.build(sys => {
      sys.createEntity(GlobalDest);
      const d1 = sys.createEntity(GlobalDest);
      const d2 = sys.createEntity(GlobalDest);
      sys.createEntity(MultiOrigin, {target1: d1, target2: d2});
      sys.createEntity(MultiOrigin);
      sys.createEntity(Origin, {target: d1});
      sys.createEntity(Origin, {target: d2});
    });
    await world.execute();
    expect(total.multiOrigin).toBe(2);
    expect(total.origin).toBe(2);
  });

  test('fail to access backrefs to recently removed component when not enabled', async () => {
    const world = await createWorld();
    world.build(sys => {
      const d1 = sys.createEntity(GlobalDest);
      const o = sys.createEntity(Origin, {target: d1});
      o.remove(Origin);
      sys.accessRecentlyDeletedData();
      expect(() => d1.read(GlobalDest).targeters).toThrow();
    });
  });

  test('backrefs to recently removed component', async () => {
    const world = await createWorld();
    let d1: Entity;
    world.build(sys => {
      d1 = sys.createEntity(GlobalDestWithStales).hold();
      sys.createEntity(Origin, {target: d1});
      const o = sys.createEntity(Origin, {target: d1});
      o.remove(Origin);
      expect(d1.read(GlobalDestWithStales).targeters.length).toBe(1);
      sys.accessRecentlyDeletedData();
      expect(d1.read(GlobalDestWithStales).targeters.length).toBe(2);
    });
    await world.execute();
    await world.execute();
    world.build(sys => {
      expect(d1.read(GlobalDestWithStales).targeters.length).toBe(1);
      sys.accessRecentlyDeletedData();
      expect(d1.read(GlobalDestWithStales).targeters.length).toBe(1);
    });
  });
});

describe('backrefs storage variants', () => {

  test('smcurrent entities list', async () => {
    const world = await createWorld();
    world.build(sys => {
      const d1 = sys.createEntity(GlobalDest);
      for (let i = 0; i < 10; i++) sys.createEntity(Origin, {target: d1});
      expect(d1.read(GlobalDest).targeters.length).toBe(10);
    });
  });

  test('large entities list, with index', async () => {
    const world = await createWorld();
    world.build(sys => {
      const d1 = sys.createEntity(GlobalDest);
      const origins = [];
      for (let i = 0; i < 110; i++) origins.push(sys.createEntity(Origin, {target: d1}));
      expect(d1.read(GlobalDest).targeters.length).toBe(110);
      for (let i = 0; i < 10; i++) origins[i].remove(Origin);
      expect(d1.read(GlobalDest).targeters.length).toBe(100);
    });
  });

  test('single tag', async () => {
    const world = await createWorld();
    world.build(sys => {
      const d1 = sys.createEntity(GlobalDest);
      sys.createEntity(MultiOrigin, {target1: d1});
      expect(d1.read(GlobalDest).targeters.length).toBe(1);
    });
  });

  test('tag array', async () => {
    const world = await createWorld();
    world.build(sys => {
      const d1 = sys.createEntity(GlobalDest);
      const o = sys.createEntity(MultiOrigin, {target1: d1, target2: d1});
      expect(d1.read(GlobalDest).targeters.length).toBe(1);
      o.write(MultiOrigin).target2 = undefined;
      expect(d1.read(GlobalDest).targeters.length).toBe(1);
    });
  });

  // TODO: test internal indexes once we have arrays or structs
  // TODO: test tag sets once we can create a component type with 1000+ fields
});

describe('refs affected by entity deletion', () => {

  test('clear refs to deleted entity', async () => {
    const world = await createWorld();
    let o: Entity;
    world.build(sys => {
      const d1 = sys.createEntity(GlobalDest);
      o = sys.createEntity(Origin, {target: d1}).hold();
      d1.delete();
      expect(o.read(Origin).target).toBe(undefined);
      sys.accessRecentlyDeletedData();
      expect(o.read(Origin).target).toBe(d1);
    });
    await world.execute();
    await world.execute();
    world.build(sys => {
      sys.accessRecentlyDeletedData();
      expect(o.read(Origin).target).toBe(undefined);
    });
  });

  test('overwrite cleared refs before deletion finalized', async () => {
    const world = await createWorld();
    let o: Entity;
    let d2: Entity;
    world.build(sys => {
      const d1 = sys.createEntity(GlobalDest);
      d2 = sys.createEntity(GlobalDest).hold();
      o = sys.createEntity(Origin, {target: d1}).hold();
      d1.delete();
      expect(o.read(Origin).target).toBe(undefined);
      sys.accessRecentlyDeletedData();
      expect(o.read(Origin).target?.isSame(d1)).toBe(true);
      sys.accessRecentlyDeletedData(false);
      o.write(Origin).target = d2;
      expect(o.read(Origin).target?.isSame(d2)).toBe(true);
    });
    await world.execute();
    await world.execute();
    expect(o!.read(Origin).target?.isSame(d2!)).toBe(true);
  });

  test('overwrite cleared ref with same ref before deletion finalized', async () => {
    const world = await createWorld();
    let o: Entity;
    let d1: Entity;
    world.build(sys => {
      d1 = sys.createEntity(GlobalDest);
      o = sys.createEntity(Origin, {target: d1}).hold();
      o.write(Origin).target = undefined;
      expect(o.read(Origin).target).toBe(undefined);
      o.write(Origin).target = d1;
      expect(o.read(Origin).target?.isSame(d1)).toBe(true);
    });
    await world.execute();
    await world.execute();
    expect(o!.read(Origin).target?.isSame(d1!)).toBe(true);
  });
});
