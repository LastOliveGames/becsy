import {field, component, World, Entity} from '../src';

class Stuff {
  value: number;
}

@component class Big {
  @field.boolean declare boolean: boolean;
  @field.uint8 declare uint8: number;
  @field.int8 declare int8: number;
  @field.uint16 declare uint16: number;
  @field.int16 declare int16: number;
  @field.uint32 declare uint32: number;
  @field.int32 declare int32: number;
  @field.float32 declare float32: number;
  @field.float64 declare float64: number;
  @field.staticString(['foo', 'bar', 'baz']) declare staticString: string;
  @field.dynamicString(14) declare dynamicString: string;
  @field.dynamicString(1) declare shortDynamicString: string;
  @field.ref declare ref?: Entity;
  @field.object declare object: Stuff;
  @field.weakObject declare weakObject: Stuff;
}

async function testReadWrite(prop: string, values: any[]): Promise<void> {
  const world = await World.create();
  world.build(system => {
    const entity = system.createEntity(Big);
    for (const value of values) {
      (entity.write(Big) as any)[prop] = value;
      expect((entity.read(Big) as any)[prop]).toBe(value);
    }
    // Check that non-zero offsets work too.
    const entity2 = system.createEntity(Big);
    for (const value of values) {
      (entity2.write(Big) as any)[prop] = value;
      expect((entity2.read(Big) as any)[prop]).toBe(value);
    }
  });
}


describe('getting and setting fields of various types', () => {

  test('boolean', async () => {
    await testReadWrite('boolean', [false, true]);
  });

  test('uint8', async () => {
    await testReadWrite('uint8', [0, 127, 255]);
  });

  test('int8', async () => {
    await testReadWrite('int8', [0, 127, -128]);
  });

  test('uint16', async () => {
    await testReadWrite('uint16', [0, 2 ** 15 - 1, 2 ** 16 - 1]);
  });

  test('int16', async () => {
    await testReadWrite('int16', [0, 2 ** 15 - 1, -(2 ** 15)]);
  });

  test('uint32', async () => {
    await testReadWrite('uint32', [0, 2 ** 31 - 1, 2 ** 32 - 1]);
  });

  test('int32', async () => {
    await testReadWrite('int32', [0, 2 ** 31 - 1, -(2 ** 31)]);
  });

  test('float32', async () => {
    await testReadWrite('float32', [0, 2 ** 24, -(2 ** 24), 0.5, -0.5]);
  });

  test('float64', async () => {
    await testReadWrite('float64', [0, 2 ** 53, -(2 ** 53), 0.5, -0.5]);
  });

  test('staticString', async () => {
    await testReadWrite('staticString', ['foo', 'bar', 'baz']);
  });

  test('dynamicString', async () => {
    await testReadWrite('dynamicString', ['', 'a', 'foo', 'foobarbazqux12', '🤷‍♂️']);
    await testReadWrite('shortDynamicString', ['', 'a']);
  });

  test('ref', async () => {
    const world = await World.create();
    world.build(system => {
      const a = system.createEntity(Big);
      const b = system.createEntity(Big);
      a.write(Big).ref = b;
      expect(a.read(Big).ref).toBe(b);
      a.write(Big).ref = undefined;
      expect(a.read(Big).ref).toBe(undefined);
    });
  });

  test('object', async () => {
    const stuff = new Stuff();
    await testReadWrite('object', [undefined, null, stuff]);
  });

  test('weakObject', async () => {
    const stuff = new Stuff();
    await testReadWrite('weakObject', [undefined, null, stuff]);
  });

  // Can't figure out how to force garbage collection to test this, even after following
  // https://stackoverflow.com/questions/65175380.
  test.skip('weakObject garbage collection', async () => {
    const a: any[] = [new Stuff()];
    const world = await World.create();
    let entity: Entity;  // this will get released, but nothing will overwrite it
    world.build(system => {
      entity = system.createEntity(Big);
      entity.write(Big).weakObject = a[0];
      expect(entity.read(Big).weakObject).toBe(a[0]);
    });
    delete a[0];
    eval('%CollectGarbage(true)');  // eslint-disable-line no-eval
    expect(entity!.read(Big).weakObject).toBe(undefined);
  });

});

