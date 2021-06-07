import type {ComponentType} from './component';
import {ControlOptions, Dispatcher, Frame, FrameImpl, WorldOptions} from './dispatcher';
import type {Stats} from './stats';
import type {System, SystemGroup} from './system';

const MAGIC_COOKIE = {};


export class World {
  private readonly __dispatcher: Dispatcher;

  /**
   * Creates a world that contains entities, components and systems.  All systems will be
   * instantiated and initialized before the returned promise resolves.
   *
   * You cannot add more component or system types once the world has been created. You can create
   * multiple worlds but they will not share entities, and must not share component types.  (They
   * can share system types, but each will have its own instances of them.)
   *
   * @param options The options with which to initialize the world.
   *
   * @returns A promise of a new world to do with as you please.
   */
  static async create(options: WorldOptions): Promise<World> {
    const world = new World(options, MAGIC_COOKIE);
    await world.__dispatcher.initialize();
    return world;
  }

  private constructor(options: WorldOptions, magicCookie: any) {
    if (magicCookie !== MAGIC_COOKIE) {
      throw new Error(`Don't call World constructor directly; use World.create instead`);
    }
    this.__dispatcher = new Dispatcher(options);
  }

  /**
   * Executes a function that creates and updates entities.  The function gets executed in the
   * context of a no-op system so it can access all its convenience methods.  You can only invoke
   * this method when the world is not executing, e.g. during initial setup or between frames.
   *
   * @param callback The function to execute.  It receives a system as the sole argument, which it
   * can use to create new entities.  You can retain references to these entities within the
   * function but you must be careful not to let them leak out, as the entity objects are merely
   * handles that will be reassigned without warning.  (The entities themselves will persist, of
   * course.)
   */
  build(callback: (system: System) => void): void {
    this.__dispatcher.executeFunction(callback);
  }

  /**
   * Creates a new entity and add it to the world.  The entity is not returned -- if you need that,
   * use `build` instead.  You can only invoke this method when the world is not executing, e.g.
   * during initial setup or between frames.
   *
   * @param initialComponents The types of the components to add to the new entity, optionally
   * interleaved with their initial properties.
   */
  createEntity(...initialComponents: (ComponentType<any> | Record<string, unknown>)[]): void {
    this.__dispatcher.createEntity(initialComponents);
  }

  /**
   * Executes all the systems defined during the world's creation.  Currently they're executed in
   * the order they were defined but you shouldn't rely on that, as becsy will reorder systems based
   * on scheduling constraints in the near future.  If your world is single-threaded then execution
   * is synchronous and you can ignore the returned promise.
   *
   * @param time The time of this frame's execution.  This will be set on every system's `time`
   * property and defaults to the time when `execute` was called.  It's not used internally so you
   * can pass in any numeric value that's expected by your systems.
   *
   * @param delta The duration since the last frame's execution.  This will be set on every system's
   * `delta` property and default to the duration since the previous call to `execute`. It's not
   * used internally so you can pass in any numeric value that's expected by your systems.
   */
  execute(time?: number, delta?: number): Promise<void> {
    return this.__dispatcher.execute(time, delta);
  }

  /**
   * Controls the running state of systems by stopping or restarting them.  Stopped systems won't
   * update their queries and generally won't consume resources.  Restarting a system is a
   * potentially expensive operation so you should only use this facility for major state changes,
   * e.g. between scenes.  Restarted systems will not backfill any reactive queries with events that
   * happened while they were stopped.
   *
   * You can call this method at any time but the control instructions will only be applied between
   * frames.
   *
   * @param options The control instructions.
   */
  control(options: ControlOptions): void {
    this.__dispatcher.control(options);
  }

  /**
   * Creates an executor that allows you to run a subset of all defined systems in a frame, or run
   * some of them multiple times.  You can switch which executor you use between frames or even
   * interleave running becsy's default execution strategy with your own executors.  However, if
   * there are systems that won't be running for a while (because they're not in any of your
   * executor's groups) you must still stop them explicitly or you'll run out of reserved buffer
   * space.
   *
   * Creating an executor is a potentially expensive operation so you should create them all up
   * front for the various combinations of system groups you might want to run.
   *
   * @param groups All the possible groups of systems that this executor might want to run.  The
   * groups must be a subset of the world's defined groups.  Every group must be executed regularly
   * at least once every few frames, otherwise you'll likely overflow reserved buffer space.  (This
   * is true even if the groups overlap, as execution is tracked at a group level, not for
   * individual systems.)
   *
   * @returns A frame executor that lets you manually run system groups within a frame.
   */
  createCustomExecutor(...groups: SystemGroup[]): Frame {
    return new FrameImpl(this.__dispatcher, groups);
  }

  get stats(): Stats {
    return this.__dispatcher.stats;
  }
}

