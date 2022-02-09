import {field, System, World} from '../src';

class A {
  @field.int32 declare value: number;
}

class SysA extends System {

}


beforeEach(() => {
  // This bypasses the exception made for tests that allows components to be reused across worlds.
  process.env.NODE_ENV = 'development';
});

afterEach(() => {
  process.env.NODE_ENV = 'test';
});


describe('world creation', () => {

  test('duplicate component types', async () => {
    await (await World.create({defs: [A, A]})).terminate();
  });

  test('duplicate systems', async () => {
    await (await World.create({defs: [SysA, SysA]})).terminate();
  });

  test('duplicate systems with props first', async () => {
    await (await World.create({defs: [SysA, {foo: 'bar'}, SysA]})).terminate();
  });

  test('duplicate systems with props second', async () => {
    await (await World.create({defs: [SysA, SysA, {foo: 'bar'}]})).terminate();
  });

  test('duplicate systems with duplicate props', async () => {
    await expect(World.create({defs: [SysA, {foo: 'bar'}, SysA, {foo: 'bar'}]}))
      .rejects.toThrowError();
  });

  test('worlds cannot share components', async () => {
    const world1 = await World.create({defs: [A]});
    await expect(World.create({defs: [A]})).rejects.toThrowError();
    await world1.terminate();
  });

});

describe('world destruction', () => {
  test('terminate world then create another one with same components', async () => {
    let world = await World.create({defs: [A]});
    await world.terminate();
    world = await World.create({defs: [A]});
    await world.terminate();
  });
});
