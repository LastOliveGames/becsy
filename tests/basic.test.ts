import {Component, System, Type, World} from '../src';

class A extends Component {
  static schema = {
    byte: Type.uint8
  };

  declare byte: number;
}

class SystemA extends System {
  private readonly things = this.query().with(A).write;

  execute() {
    for (const thing of this.things.all) {
      thing.mutate(A).byte *= 2;
    }
  }
}

test('iteration', () => {
  const world = new World({maxEntities: 5, componentTypes: [A], systems: [SystemA]});
  world.createEntity(entity => {entity.add(A, {byte: 1});});
  world.execute();
});
