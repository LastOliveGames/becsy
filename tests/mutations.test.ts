import {component, type Entity, field, System, type SystemType, World} from '../src';


@component class A {
  @field.uint8 declare value: number;
}

@component class B {
  @field.uint8 declare value: number;
}

@component class C {
  @field.ref declare ref: Entity;
}


let lastValue = 0;

class AddRemoveBToA extends System {
  entities = this.query(q => q.current.with(A).and.using(B).write);
  iteration = 0;

  execute() {
    this.iteration += 1;
    if (this.iteration <= 2) {
      for (const entity of this.entities.current) {
        entity.add(B, {value: this.iteration});
        entity.remove(B);
      }
    } else {
      this.accessRecentlyDeletedData();
      for (const entity of this.entities.current) {
        lastValue += entity.read(B).value;
      }
    }
  }
}

class AddRemoveBToATwice extends System {
  entities = this.query(q => q.current.with(A).and.using(B).write);
  iteration = 0;

  execute() {
    this.iteration += 1;
    if (this.iteration === 1) {
      for (const entity of this.entities.current) {
        entity.add(B);
        entity.remove(B);
        entity.add(B);
        entity.remove(B);
      }
    }
  }
}

async function createWorld(...systems: SystemType<System>[]): Promise<World> {
  return World.create({
    maxEntities: 100, defaultComponentStorage: 'packed', defs: [systems]
  });
}


describe('removing components', () => {
  beforeEach(() => {
    lastValue = 0;
  });

  test('resurrect component', async () => {
    const world = await createWorld(AddRemoveBToA);
    world.createEntity(A);
    await world.execute();
    await world.execute();
    await world.execute();
    expect(lastValue).toBe(2);
  });

  test('finalize component removal', async () => {
    const world = await createWorld(AddRemoveBToA);
    world.createEntity(A);
    await world.execute();
    await world.execute();
    await world.execute();
    expect(world.execute()).rejects.toThrowError();
  });

  test('resurrect component and remove again', async () => {
    const world = await createWorld(AddRemoveBToATwice);
    world.createEntity(A);
    await world.execute();
    await world.execute();
  });

  test('remove component with empty ref', async () => {
    const world = await createWorld();
    world.build(sys => {
      const c = sys.createEntity(C);
      c.remove(C);
    });
  });

});
