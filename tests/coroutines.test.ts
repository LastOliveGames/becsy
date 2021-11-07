import {co, component, Coroutine, Entity, field, System, SystemType, World} from '../src';

let counter = 0;
let coroutine: () => Generator;
let wrapperHandle: Coroutine;
let coroutineHandle: Coroutine;

@component class Foo {
  @field.int32 declare bar: number;
}

class StartCoroutine extends System {
  q = this.query(q => q.using(Foo));

  initialize(): void {
    coroutineHandle = this.start(coroutine());
  }
}

class StartNestedCoroutine extends System {
  initialize(): void {
    wrapperHandle = this.wrap();
  }

  @co *wrap() {
    counter += 1;
    const v = (yield coroutineHandle = this.start(coroutine())) as number;
    counter += v;
  }
}

class CatchNestedCoroutine extends System {
  initialize(): void {
    this.wrap();
  }

  @co *wrap() {
    try {
      yield this.start(coroutine());
    } catch (e) {
      counter += 1;
    }
  }
}

async function createWorld(...systems: SystemType<System>[]): Promise<World> {
  return World.create({
    maxEntities: 100, defaultComponentStorage: 'sparse', defs: systems
  });
}

function sleep(seconds: number) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

beforeEach(() => {
  counter = 0;
});


describe('test running', () => {
  it('executes a coroutine', async () => {
    coroutine = function*() {
      counter += 1;
      yield;
    };
    const world = await createWorld(StartCoroutine);
    await world.execute();
    expect(counter).toBe(1);
  });

  it('propagates an exception', async () => {
    coroutine = function*() {
      throw new Error('foo');
      yield;
    };
    const world = await createWorld(StartCoroutine);
    await expect(world.execute()).rejects.toThrow('foo');
  });

  it('executes a nested coroutine with return value', async () => {
    coroutine = function*() {
      counter += 1;
      yield;
      return 5;
    };
    const world = await createWorld(StartNestedCoroutine);
    await world.execute();
    expect(counter).toBe(2);
    await world.execute();
    expect(counter).toBe(7);
  });

  it('propagates a nested exception', async () => {
    coroutine = function*() {
      throw new Error('foo');
      yield;
    };
    const world = await createWorld(StartNestedCoroutine);
    // First execute starts wrapper, starts nested coroutine, and throws error.
    await world.execute();
    // Second execute advances wrapper and rethrows the exception.
    await expect(world.execute()).rejects.toThrow('foo');
  });

  it('catches a nested exception', async () => {
    coroutine = function*() {
      throw new Error('foo');
      yield;
    };
    const world = await createWorld(CatchNestedCoroutine);
    await world.execute();
    await world.execute();
    expect(counter).toBe(1);
  });
});


describe('test waiting', () => {
  it('waits for the next frame on yield', async () => {
    coroutine = function*() {
      counter += 1;
      yield;
      counter += 1;
    };
    const world = await createWorld(StartCoroutine);
    await world.execute();
    expect(counter).toBe(1);
    await world.execute();
    expect(counter).toBe(2);
  });

  it('skips a frame', async () => {
    coroutine = function*() {
      counter += 1;
      yield co.waitForFrames(2);
      counter += 1;
    };
    const world = await createWorld(StartCoroutine);
    await world.execute();
    expect(counter).toBe(1);
    await world.execute();
    expect(counter).toBe(1);
    await world.execute();
    expect(counter).toBe(2);
  });

  it('waits for seconds', async () => {
    coroutine = function*() {
      counter += 1;
      yield co.waitForSeconds(0.05);
      counter += 1;
    };
    const world = await createWorld(StartCoroutine);
    await world.execute();
    expect(counter).toBe(1);
    await world.execute();
    expect(counter).toBe(1);
    await sleep(0.5);
    await world.execute();
    expect(counter).toBe(2);
  });

  it('waits for condition', async () => {
    let resume = false;
    coroutine = function*() {
      counter += 1;
      yield co.waitUntil(() => resume);
      counter += 1;
    };
    const world = await createWorld(StartCoroutine);
    await world.execute();
    expect(counter).toBe(1);
    await world.execute();
    expect(counter).toBe(1);
    resume = true;
    await world.execute();
    expect(counter).toBe(2);
  });
});


describe('test cancelling', () => {
  it('cancels a coroutine from outside', async () => {
    coroutine = function*() {
      counter += 1;
      yield;
      counter += 1;
    };
    const world = await createWorld(StartCoroutine);
    await world.execute();
    expect(counter).toBe(1);
    coroutineHandle.cancel();
    await world.execute();
    expect(counter).toBe(1);
  });

  it('cancels a coroutine from inside', async () => {
    coroutine = function*() {
      counter += 1;
      co.cancel();
      yield;
      counter += 1;
    };
    const world = await createWorld(StartCoroutine);
    await world.execute();
    expect(counter).toBe(1);
    await world.execute();
    expect(counter).toBe(1);
  });

  it('cancels a nested coroutine from the top', async () => {
    coroutine = function*() {
      counter += 1;
      yield;
      counter += 2;
      return 5;
    };
    const world = await createWorld(StartNestedCoroutine);
    await world.execute();
    expect(counter).toBe(2);
    wrapperHandle.cancel();
    await world.execute();
    expect(counter).toBe(2);
  });

  it('cancels a nested coroutine from the bottom, from outside', async () => {
    coroutine = function*() {
      counter += 1;
      yield;
      counter += 2;
      return 5;
    };
    const world = await createWorld(StartNestedCoroutine);
    await world.execute();
    expect(counter).toBe(2);
    coroutineHandle.cancel();
    await world.execute();
    expect(counter).toBe(2);
  });

  it('cancels a nested coroutine from the bottom, from inside', async () => {
    coroutine = function*() {
      counter += 1;
      co.cancel();
      yield;
      counter += 2;
      return 5;
    };
    const world = await createWorld(StartNestedCoroutine);
    await world.execute();
    expect(counter).toBe(2);
    await world.execute();
    expect(counter).toBe(2);
  });

  it('cancels a coroutine if a condition is true', async () => {
    let abort = false;
    coroutine = function*() {
      co.cancelIf(() => abort);
      counter += 1;
      yield;
      counter += 1;
    };
    const world = await createWorld(StartCoroutine);
    await world.execute();
    expect(counter).toBe(1);
    abort = true;
    await world.execute();
    expect(counter).toBe(1);
  });

  it('cancels a coroutine if a condition is true when it is blocked on another', async () => {
    let abort = false;
    coroutine = function*() {
      counter += 1;
      yield;
      counter += 1;
      yield;
      return 5;
    };
    const world = await createWorld(StartNestedCoroutine);
    wrapperHandle.cancelIf(() => abort);
    await world.execute();
    expect(counter).toBe(2);
    abort = true;
    await world.execute();
    expect(counter).toBe(2);
    await world.execute();
    expect(counter).toBe(2);
  });

  it('cancels a scoped coroutine if the entity has been deleted', async () => {
    let entity: Entity;
    coroutine = function*() {
      counter += 1;
      yield;
      counter += 1;
    };
    const world = await createWorld(StartCoroutine);
    world.build(sys => {
      entity = sys.createEntity().hold();
      coroutineHandle.scope(entity);
    });
    await world.execute();
    expect(counter).toBe(1);
    world.build(sys => {
      entity.delete();
    });
    await world.execute();
    expect(counter).toBe(1);
  });

  it('cancels a coroutine if a component has been removed', async () => {
    let entity: Entity;
    coroutine = function*() {
      counter += 1;
      yield;
      counter += 1;
    };
    const world = await createWorld(StartCoroutine);
    world.build(sys => {
      entity = sys.createEntity(Foo).hold();
      coroutineHandle.scope(entity).cancelIfComponentMissing(Foo);
    });
    await world.execute();
    expect(counter).toBe(1);
    world.build(sys => {
      entity.remove(Foo);
    });
    await world.execute();
    expect(counter).toBe(1);
  });
});
