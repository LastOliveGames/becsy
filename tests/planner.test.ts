import {component, field, system, System, Type, World} from '../src';

@component class Local {
  @field(Type.object) declare foo: any;
}

@component({restrictedToMainThread: true}) class Main {
  @field(Type.object) declare foo: any;
}

@system(s => s.onManyThreads) export class A extends System {}

class B extends System {
  x = this.query(q => q.with(Local));
}

class C extends System {
  x = this.query(q => q.with(Local));
}

class D extends System {
  y = this.attach(A);
}

class E extends System { }
class F extends System {
  sked = this.schedule(s => s.after(E));
}

class G extends System { }
class H extends System {
  sked = this.schedule(s => s.after(G));
}

class I extends System {
  sked = this.schedule(s => s.onMainThread);
}

class J extends System {
  x = this.query(q => q.with(Main));
}

// TODO: un-skip when multithreading implemented
describe.skip('planner lane assignment', () => {

  test('merges readers of unshared component types into one lane', async () => {
    const world = await World.create({threads: 2, defs: [B, C]});
    expect(world.stats.systems.A.worker).toBe(-1);
    expect(world.stats.systems.B.worker).toBe(1);
    expect(world.stats.systems.C.worker).toBe(1);
  });

  test('merges attached systems into one lane', async () => {
    const world = await World.create({threads: 2, defs: [D]});
    expect(world.stats.systems.A.worker).toBe(1);
    expect(world.stats.systems.D.worker).toBe(1);
  });

  test('merges most dependent systems together into lanes', async () => {
    const world = await World.create({threads: 2, defs: [E, F, G, H]});
    expect(world.stats.systems.E.worker).toBe(1);
    expect(world.stats.systems.F.worker).toBe(1);
    expect(world.stats.systems.G.worker).toBe(2);
    expect(world.stats.systems.H.worker).toBe(2);
  });

  test('puts main thread system in lane zero', async () => {
    const world = await World.create({threads: 2, defs: [I]});
    expect(world.stats.systems.I.worker).toBe(0);
  });

  test('puts reader of main thread component in lane zero', async () => {
    const world = await World.create({threads: 2, defs: [J]});
    expect(world.stats.systems.J.worker).toBe(0);
  });

  test('avoids merging into lane zero', async () => {
    const world = await World.create({threads: 2, defs: [B, C, D, E, F, G, H]});
    expect(world.stats.systems.A.worker).toBeGreaterThan(0);
    expect(world.stats.systems.B.worker).toBeGreaterThan(0);
    expect(world.stats.systems.C.worker).toBeGreaterThan(0);
    expect(world.stats.systems.D.worker).toBeGreaterThan(0);
    expect(world.stats.systems.E.worker).toBeGreaterThan(0);
    expect(world.stats.systems.F.worker).toBeGreaterThan(0);
    expect(world.stats.systems.G.worker).toBeGreaterThan(0);
    expect(world.stats.systems.H.worker).toBeGreaterThan(0);
  });
});
