/* eslint-disable lines-between-class-members */
import {field, component, World, Entity, Type} from '../src';

class Stuff {
  value: number;
}

class Vector3 {
  x: number;
  y: number;
  z: number;

  add(that: Vector3): void {
    this.x += that.x;
    this.y += that.y;
    this.z += that.z;
  }
}

const v3Type = Type.vector(Type.int8, ['x', 'y', 'z'], Vector3);

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
  @field.int32.vector(3) declare vectorWithLength: [number, number, number];
  @field.float64.vector(['x', 'y', 'z']) declare vectorWithProps:
    [number, number, number] & {x: number, y: number, z: number};
  @field.int16.vector(['x', 'y', 'z'], Vector3) declare vectorWithClass: Vector3;
  @field(v3Type) declare vectorWithPredefined: Vector3;
  @field.staticString(['foo', 'bar', 'baz']) declare staticString: string;
  @field.dynamicString(14) declare dynamicString: string;
  @field.dynamicString(1) declare shortDynamicString: string;
  @field.ref declare ref?: Entity;
  @field.object declare object: Stuff;
  @field.weakObject declare weakObject: Stuff;
}

async function testReadWrite(
  prop: string | number | (string | number)[], values: any[]
): Promise<void> {
  const world = await World.create();
  world.build(system => {
    const entity = system.createEntity(Big);
    for (const value of values) {
      setProp(entity.write(Big), prop, value);
      compare(entity.read(Big), prop, value);
      compare(entity.write(Big), prop, value);
    }
    // Check that non-zero offsets work too.
    const entity2 = system.createEntity(Big);
    for (const value of values) {
      setProp(entity2.write(Big), prop, value);
      compare(entity2.read(Big), prop, value);
      compare(entity2.write(Big), prop, value);
    }
  });
}

function setProp(object: any, prop: string | number | (string | number)[], value: any): void {
  if (!Array.isArray(prop)) prop = [prop];
  for (let i = 0; i < prop.length - 1; i++) object = object[prop[i]];
  object[prop[prop.length - 1]] = value;
}

function getProp(object: any, prop: string | number | (string | number)[]): any {
  if (!Array.isArray(prop)) prop = [prop];
  for (let i = 0; i < prop.length; i++) object = object[prop[i]];
  return object;
}

function compare(object: any, prop: string | number | (string | number)[], value: any): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      expect(getProp(object, [prop, i].flat())).toBe(value[i]);
      expect(getProp(object, [prop, i].flat())).toBe(value[i]);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const key in value) {
      expect(getProp(object, [prop, key].flat())).toBe(value[key]);
      expect(getProp(object, [prop, key].flat())).toBe(value[key]);
    }
  } else {
    expect(getProp(object, prop)).toBe(value);
    expect(getProp(object, prop)).toBe(value);
  }

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

  test('vectorWithLength', async () => {
    await testReadWrite(['vectorWithLength', 0], [0, 42, -10]);
    await testReadWrite(['vectorWithLength', 2], [0, 42, -10]);
    await testReadWrite('vectorWithLength', [[0, -1, 2]]);
  });

  test('vectorWithProps', async () => {
    await testReadWrite(['vectorWithProps', 0], [0, 42, -10]);
    await testReadWrite(['vectorWithProps', 'x'], [0, 42, -10]);
    await testReadWrite(['vectorWithProps', 'z'], [0, 42, -10]);
    await testReadWrite('vectorWithProps', [[0, -1, 2]]);
    await testReadWrite('vectorWithProps', [{x: 0, y: -1, z: 2}]);
  });

  test('vectorWithClass', async () => {
    await testReadWrite(['vectorWithClass', 0], [0, 42, -10]);
    await testReadWrite(['vectorWithClass', 'x'], [0, 42, -10]);
    await testReadWrite(['vectorWithClass', 'z'], [0, 42, -10]);
    await testReadWrite('vectorWithClass', [[0, -1, 2]]);
    await testReadWrite('vectorWithClass', [{x: 0, y: -1, z: 2}]);
    const world = await World.create();
    world.build(system => {
      const entity = system.createEntity(Big, {vectorWithClass: {x: 1, y: 2, z: 3}});
      const entity2 = system.createEntity(Big, {vectorWithClass: {x: 5, y: 9, z: -2}});
      entity.write(Big).vectorWithClass.add(entity2.read(Big).vectorWithClass);
      compare(entity.read(Big), 'vectorWithClass', {x: 6, y: 11, z: 1});
    });
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

