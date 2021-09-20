import {Entity, System, World} from '../src';

let message: string;

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


describe('system setup', () => {

  test('attach a system', async() => {
    const world = await World.create({defs: [SystemB, SystemA]});
    await world.execute();
    expect(message).toBe('hello');
  });

  test('create and hold an entity during initialize', async() => {
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
});
