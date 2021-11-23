import {Entity, field, System, World} from '../src';

let message: string;

class Foo {
  @field.int16 declare speed: number;
}

class Bar {
  @field.int16 declare direction: number;
}


class SystemA extends System {
  message: string;
  execute() {
    message = this.message;
  }
}

class SystemB extends System {
  sked = this.schedule(s => s.before(SystemA));
  systemA = this.attach(SystemA);
  execute() {
    this.systemA.message = 'hello';
  }
}

class SystemC extends System {
  foo = this.singleton.read(Foo);
  bar = this.singleton.write(Bar);

  initialize() {
    this.bar.direction = 45;
    message = `foo ${this.foo.speed} bar ${this.bar.direction}`;
  }
}

class SystemD extends System {
  foo = this.singleton.write(Foo, {speed: 100});
}


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

  test('order systems transitively', async () => {
    const group1 = System.group(SystemA);
    const group2 = System.group(SystemC);
    const group3 = System.group(SystemD);
    await World.create({defs: [
      Foo, Bar,
      group1.schedule(s => s.after(group2)),
      group2.schedule(s => s.beforeWritesTo(Foo)),
      group3.schedule(s => s.beforeReadsFrom(Foo).after(group1))
    ]});
  });
});
