import {field, System, World} from '../src';

class A {
  @field.int32 declare value: number;
}

class SysA extends System {

}


describe('world creation', () => {

  test('duplicate component types', async () => {
    await World.create({defs: [A, A]});
  });

  test('duplicate systems', async () => {
    await World.create({defs: [SysA, SysA]});
  });

  test('duplicate systems with props first', async () => {
    await World.create({defs: [SysA, {foo: 'bar'}, SysA]});
  });

  test('duplicate systems with props second', async () => {
    await World.create({defs: [SysA, SysA, {foo: 'bar'}]});
  });

  test('duplicate systems with duplicate props', async () => {
    await expect(World.create({defs: [SysA, {foo: 'bar'}, SysA, {foo: 'bar'}]}))
      .rejects.toThrowError();
  });

});
