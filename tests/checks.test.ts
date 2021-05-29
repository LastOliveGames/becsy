import {field, component, Type, World} from '../src';

@component class A {
  @field(Type.int32) declare value: number;
}

describe('exercising validity checks', () => {

  test('reuse readable component', async() => {
    const world = await World.create({defs: [A]});
    world.build(system => {
      const entity1 = system.createEntity(A, {value: 1});
      const a1 = entity1.read(A);
      const unused = entity1.read(A);
      expect(() => {void a1.value;}).toThrow();
    });
  });

  test('reuse writable component', async() => {
    const world = await World.create({defs: [A]});
    world.build(system => {
      const entity1 = system.createEntity(A, {value: 1});
      const a1 = entity1.write(A);
      const unused = entity1.write(A);
      expect(() => {a1.value = 2;}).toThrow();
    });
  });

});
