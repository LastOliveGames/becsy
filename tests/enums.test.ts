import {field, component, World, Entity, System} from '../src';
import {CheckError} from '../src/errors';

let message: string;

const state = World.defineEnum();

@component(state) class Start {
  @field.int32 declare value: number;
}

@component(state) class Middle {}

@component(state) class End {
  @field.float64 declare answer: number;
}

@component class A {}
@component class B {}
const state2 = World.defineEnum(A, B);

describe('testing enum components', () => {

  test('enum bitfield packing', async () => {
    await World.create();
    expect((Start as any).__binding.shapeOffset).toBe(0);
    expect((Start as any).__binding.shapeMask).toBe(6);
    expect((Start as any).__binding.shapeValue).toBe(2);
    expect((Middle as any).__binding.shapeOffset).toBe(0);
    expect((Middle as any).__binding.shapeMask).toBe(6);
    expect((Middle as any).__binding.shapeValue).toBe(4);
    expect((End as any).__binding.shapeOffset).toBe(0);
    expect((End as any).__binding.shapeMask).toBe(6);
    expect((End as any).__binding.shapeValue).toBe(6);
  });

  test('manual enum bitfield packing', async () => {
    await World.create({defs: [state, state2]});
    expect((A as any).__binding.shapeOffset).toBe(0);
    expect((A as any).__binding.shapeMask).toBe(24);
    expect((A as any).__binding.shapeValue).toBe(8);
    expect((B as any).__binding.shapeOffset).toBe(0);
    expect((B as any).__binding.shapeMask).toBe(24);
    expect((B as any).__binding.shapeValue).toBe(16);
  });

  test('add and remove enum component', async () => {
    const world = await World.create();
    let e1: Entity;
    world.build(sys => {
      e1 = sys.createEntity(Start, {value: 1}).hold();
      e1.write(Start).value = 2;
    });
    expect(e1!.read(Start).value).toBe(2);
    expect(e1!.has(Start)).toBe(true);
    expect(e1!.hasWhich(state)).toBe(Start);
    world.build(sys => {
      e1.remove(Start);
    });
    expect(e1!.has(Start)).toBe(false);
    expect(e1!.hasWhich(state)).toBe(undefined);
  });

  test('replace enum component', async () => {
    const world = await World.create();
    let e1: Entity;
    world.build(sys => {
      e1 = sys.createEntity().hold();
      e1.add(Start, {value: 1});
      e1.write(Start).value = 2;
      e1.add(Middle);
    });
    expect(e1!.has(Start)).toBe(false);
    expect(e1!.has(Middle)).toBe(true);
    expect(e1!.hasWhich(state)).toBe(Middle);
  });

  test('remove enum', async () => {
    const world = await World.create();
    let e1: Entity;
    world.build(sys => {
      e1 = sys.createEntity(Start, {value: 1}).hold();
      e1.write(Start).value = 2;
    });
    expect(e1!.read(Start).value).toBe(2);
    expect(e1!.has(Start)).toBe(true);
    expect(e1!.hasWhich(state)).toBe(Start);
    world.build(sys => {
      e1.remove(state);
    });
    expect(e1!.has(Start)).toBe(false);
    expect(e1!.hasWhich(state)).toBe(undefined);
  });

  test('query with enum component', async () => {
    const world = await World.create({defs: [
      class Finder extends System {
        entities = this.query(q => q.current.with(Start));
        execute() {
          message = '';
          for (const entity of this.entities.current) message += entity.read(Start).value;
        }
      }
    ]});
    world.createEntity(Start, {value: 1});
    world.createEntity(Middle);
    world.createEntity(End, {answer: 2});
    await world.execute();
    expect(message).toBe('1');
  });

  test('query with replaced enum component', async () => {
    const world = await World.create({
      defs: [
        class Finder extends System {
          entities = this.query(q => q.current.with(Start));
          execute() {
            message = '';
            for (const entity of this.entities.current) message += entity.read(Start).value;
          }
        }
      ]
    });
    let e1: Entity;
    world.build(sys => {
      e1 = sys.createEntity(Middle).hold();
    });
    await world.execute();
    expect(message).toBe('');
    world.build(sys => {
      e1.add(Start, {value: 5});
    });
    await world.execute();
    expect(message).toBe('5');
  });

  test('query with any enum', async () => {
    const world = await World.create({
      defs: [
        class Finder extends System {
          entities = this.query(q => q.current.withAny(state));
          execute() {
            message = '' + this.entities.current.length;
          }
        }
      ]
    });
    world.createEntity(Start);
    world.createEntity(Middle);
    world.createEntity();
    await world.execute();
    expect(message).toBe('2');
  });

  test('query without enum component', async () => {
    const world = await World.create({
      defs: [
        class Finder extends System {
          entities = this.query(q => q.current.without(Start, End));
          execute() {
            message = '' + this.entities.current.length;
          }
        }
      ]
    });
    world.createEntity(Start, {value: 1});
    world.createEntity(Middle);
    world.createEntity(End, {answer: 2});
    await world.execute();
    expect(message).toBe('1');
  });

  test('query without any enum', async () => {
    const world = await World.create({
      defs: [
        class Finder extends System {
          entities = this.query(q => q.current.without(state));
          execute() {
            message = '' + this.entities.current.length;
          }
        }
      ]
    });
    world.createEntity(Start, {value: 1});
    world.createEntity(Middle);
    world.createEntity(End, {answer: 2});
    world.createEntity();
    await world.execute();
    expect(message).toBe('1');
  });

  test('query for replaced enum component', async () => {
    const world = await World.create({
      defs: [
        class Finder extends System {
          entities = this.query(q => q.current.removed.with(Start));
          execute() {
            message = `${this.entities.current.length},${this.entities.removed.length}`;
          }
        }
      ]
    });
    let e1: Entity;
    world.build(sys => {
      e1 = sys.createEntity(Start).hold();
      sys.createEntity(Middle);
    });
    await world.execute();
    expect(message).toBe('1,0');
    world.build(sys => {
      e1.add(End);
    });
    await world.execute();
    expect(message).toBe('0,1');
  });

  test('query for written enum component', async () => {
    const world = await World.create({
      defs: [
        class Finder extends System {
          entities = this.query(q => q.changed.with(Start).trackWrites);
          execute() {
            message = `${this.entities.changed.length}`;
          }
        },
        state2
      ]
    });
    let e1: Entity;
    world.build(sys => {
      e1 = sys.createEntity(Start, {value: 1}).hold();
      sys.createEntity(Middle);
    });
    await world.execute();
    expect(message).toBe('0');
    world.build(sys => {
      e1.write(Start).value = 2;
    });
    await world.execute();
    expect(message).toBe('1');
  });

  test('query for match changed enum component', async () => {
    const world = await World.create({
      defs: [
        class Finder extends System {
          entities = this.query(q => q.changed.withAny(state).trackMatches);
          execute() {
            message = `${this.entities.changed.length}`;
          }
        }
      ]
    });
    let e1: Entity;
    world.build(sys => {
      e1 = sys.createEntity(Start, {value: 1}).hold();
      sys.createEntity(Middle);
    });
    await world.execute();
    expect(message).toBe('0');
    world.build(sys => {
      e1.add(Middle);
    });
    await world.execute();
    expect(message).toBe('1');
    await world.execute();
    expect(message).toBe('0');
  });

  test('query for match changed multiple enum components', async () => {
    const world = await World.create({
      defs: [
        class Finder extends System {
          entities =
            this.query(q => q.changed.withAny(state).trackMatches.and.withAny(state2).trackMatches);

          execute() {
            message = `${this.entities.changed.length}`;
          }
        },
        state2
      ]
    });
    let e1: Entity;
    world.build(sys => {
      e1 = sys.createEntity(Start, {value: 1}, A).hold();
      sys.createEntity(Middle);
    });
    await world.execute();
    expect(message).toBe('0');
    world.build(sys => {e1.add(Middle);});
    await world.execute();
    expect(message).toBe('1');
    await world.execute();
    expect(message).toBe('0');
    world.build(sys => {e1.add(B);});
    await world.execute();
    expect(message).toBe('1');
    await world.execute();
    expect(message).toBe('0');
    world.build(sys => {e1.addAll(End, A);});
    await world.execute();
    expect(message).toBe('1');
    await world.execute();
    expect(message).toBe('0');
  });

  test('enforce mutal exclusion on create', async () => {
    const world = await World.create();
    expect(() => world.createEntity(Start, Middle, End)).toThrowError(CheckError);
  });

  test('enforce mutal exclusion on addAll', async () => {
    const world = await World.create();
    world.build(sys => {
      const e1 = sys.createEntity();
      expect(() => e1.addAll(Start, Middle, End)).toThrow(CheckError);
    });
  });

  test('prevent removal of non-present enum', async () => {
    const world = await World.create();
    world.build(sys => {
      const e1 = sys.createEntity();
      expect(() => e1.remove(state)).toThrow(CheckError);
    });
  });

  test('reject type member of multiple enums', async () => {
    expect(() => World.create({defs: [World.defineEnum(Start, End)]})).rejects.toThrow(CheckError);
  });
});
