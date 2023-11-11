import {type Entity, field, System, World} from '../src';

let message: string;
let initOrder: string[];

class Foo {
  @field.int16 declare speed: number;
}

class Bar {
  @field.int16 declare direction: number;
}


class SystemA extends System {
  message: string;

  initialize() {
    initOrder.push(this.name);
  }

  execute() {
    message = this.message;
  }
}

class SystemB extends System {
  sked = this.schedule(s => s.before(SystemA));
  systemA = this.attach(SystemA);

  initialize() {
    initOrder.push(this.name);
  }

  execute() {
    this.systemA.message = 'hello';
  }
}

class SystemC extends System {
  foo = this.singleton.read(Foo);
  bar = this.singleton.write(Bar);

  initialize() {
    initOrder.push(this.name);
    this.bar.direction = 45;
    message = `foo ${this.foo.speed} bar ${this.bar.direction}`;
  }
}

class SystemD extends System {
  foo = this.singleton.write(Foo, {speed: 100});

  initialize() {
    initOrder.push(this.name);
  }
}

class SystemE extends System {
  initialize() {
    initOrder.push(this.name);
  }

  finalize() {
    message = 'finalized';
  }
}

beforeEach(() => {
  initOrder = [];
});


describe('system setup', () => {

  test('attach a system', async () => {
    const world = await World.create({defs: [SystemB, SystemA]});
    await world.execute();
    expect(message).toBe('hello');
  });

  test('create and hold an entity during initialize', async () => {
    class TestComponent { }

    let output: Entity;
    await World.create({
      defs: [TestComponent, class extends System {
        q = this.query(q => q.using(TestComponent).write);
        initialize() {
          output = this.createEntity(TestComponent).hold();
        }
      }]
    });

    expect(output!.has(TestComponent)).toBe(true);
  });

  test('declare a singleton', async () => {
    await World.create({defs: [Foo, Bar, SystemC, SystemD]});
    expect(message).toBe('foo 100 bar 45');
  });

  test('track changes in declared singleton', async () => {
    message = '';
    const world = await World.create({defs: [
      Foo,
      class WritingSystem extends System {
        foo = this.singleton.write(Foo);
        execute() {
          this.foo.speed = 100;
        }
      },
      class TrackingSystem extends System {
        entities = this.query(q => q.changed.with(Foo).trackWrites);
        execute() {
          for (const entity of this.entities.changed) {
            message = `foo ${entity.read(Foo).speed}`;
          }
        }
      }
    ]});
    await world.execute();  // first run triggers 'added', not 'changed'
    await world.execute();
    expect(message).toBe('foo 100');
  });

  test('track changes in dynamically accessed singleton', async () => {
    message = '';
    const world = await World.create({
      defs: [
        Foo,
        class WritingSystem extends System {
          decl = this.query(q => q.using(Foo).write);
          execute() {
            this.singleton.write(Foo).speed = 100;
          }
        },
        class TrackingSystem extends System {
          foo = this.singleton.read(Foo);
          entities = this.query(q => q.changed.with(Foo).trackWrites);
          execute() {
            for (const entity of this.entities.changed) {
              message = `foo ${entity.read(Foo).speed}`;
            }
          }
        }
      ]
    });
    await world.execute();  // first run triggers 'added', not 'changed'
    await world.execute();
    expect(message).toBe('foo 100');
  });

  test('order systems transitively', async () => {
    const group1 = System.group(SystemA);
    const group2 = System.group(SystemC);
    const group3 = System.group(SystemD);
    await World.create({defs: [
      Foo, Bar,
      group1.schedule(s => s.after(group2)),
      group2.schedule(s => s.beforeWritersOf(Foo)),
      group3.schedule(s => s.beforeReadersOf(Foo).after(group1))
    ]});
    expect(initOrder.join(' ')).toBe('SystemC SystemA SystemD');
  });

  test('order systems before all', async () => {
    const group2 = System.group(SystemC, SystemD);
    await World.create({
      defs: [
        Foo, Bar, SystemA,
        group2.schedule(s => s.before(s.allSystems))
      ]
    });
    expect(initOrder.join(' ')).toBe('SystemD SystemC SystemA');
  });
});

describe('system teardown', () => {
  test('finalize a system', async () => {
    const world = await World.create({defs: [SystemE]});
    await world.execute();
    await world.terminate();
    expect(message).toBe('finalized');
  });
});
