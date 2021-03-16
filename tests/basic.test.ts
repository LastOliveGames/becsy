import {component, Component, componentTypes, Entity, prop, System, Type, World} from '../src';

@component class A extends Component {
  @prop(Type.uint8) declare byte: number;
}

@component class B extends Component {
  @prop(Type.ref) declare a: Entity;
}

class SystemA extends System {
  private readonly things = this.query(q => q.with(B).read.also(A).write);

  execute() {
    for (const thing of this.things.all) {
      thing.read(B).a.write(A).byte *= 2;
    }
  }
}

class SystemB extends System {
  private readonly things = this.query(q => q.with(A).write.join('bs', j => j.with(B).ref('a')));

  execute() {
//     for (const thing of this.things.all) {
//       const a = thing.write(A);
//       for (const thing2 of a.joined.bs) {
//         a.byte += 1;
//       }
//     }
  }
}

class Check extends System {
  private readonly things = this.query(q => q.with(A).read);
  total: number;

  execute() {
    this.total = 0;
    for (const thing of this.things.all) {
      this.total += thing.read(A).byte;
    }
  }
}

test('iteration', () => {
  const check = new Check();
  const world = new World({maxEntities: 5, componentTypes, systems: [SystemA, SystemB, check]});
  world.build(createEntity => {
    const a = createEntity().add(A, {byte: 1});
    createEntity().add(B, {a});
  });
  world.execute();
  expect(check.total).toBe(2);
});

