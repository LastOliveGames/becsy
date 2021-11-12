import type {LogPointer} from './datatypes/log';
import type {Dispatcher} from './dispatcher';
import type {Entity, ReadWriteMasks} from './entity';
import {COMPONENT_ID_MASK, ENTITY_ID_BITS, ENTITY_ID_MASK} from './consts';
import type {World} from './world';  // eslint-disable-line @typescript-eslint/no-unused-vars
import {Query, QueryBox, QueryBuilder} from './query';
import {ComponentType, declareSingleton} from './component';
import {
  GroupContentsArray, now, Schedule, ScheduleBuilder, SystemGroup, SystemGroupImpl
} from './schedule';
import type {Lane} from './planner';
import type {SystemStats} from './stats';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {co, Coroutine, CoroutineFunction, Supervisor} from './coroutines';


export interface SystemType<S extends System> {
  __system: true;
  __staticScheduler?: (s: ScheduleBuilder) => ScheduleBuilder;
  new(): S;
}


export enum RunState {
  RUNNING, STOPPED
}

class SingletonPlaceholder {
  constructor(
    readonly access: 'read' | 'write',
    readonly type: ComponentType<any>,
    readonly initialValues?: Record<string, unknown>
  ) {}
}

class AttachPlaceholder {
  constructor(readonly type: SystemType<System>) {}
}


// TODO: support HMR for systems


/**
 * An encapsulated piece of functionality for your app that executes every frame, typically by
 * iterating over some components returned by a query.
 *
 * You should subclass and implement {@link System.execute} at a minimum, but take a look at the
 * other methods as well.
 */
export abstract class System {
  static readonly __system = true;

  /**
   * Create a group of systems that can be scheduled collectively, or used in
   * {@link World.createCustomExecutor} to execute a subset of all the system in a frame. The group
   * needs to be included in the world's defs, which will also automatically include all its member
   * systems.
   * @param systemTypes System classes to include in the group, each optionally followed by an
   *  object to initialize the system's properties.  A system can be a member of more than one
   *  group.
   * @returns A group of the given systems.
   */
  static group(...systemTypes: GroupContentsArray): SystemGroup {
    return new SystemGroupImpl(systemTypes);
  }

  __queryBuilders: QueryBuilder[] | null = [];
  __scheduleBuilder: ScheduleBuilder | undefined | null;
  __attachPlaceholders: AttachPlaceholder[] | null = [];
  __singletonPlaceholders: SingletonPlaceholder[] | null = [];
  __supervisor = new Supervisor(this);
  __dispatcher: Dispatcher;

  /**
   * A numeric ID, unique for systems within a world, that you can use for your own purposes.  Don't
   * change it!
   */
  id: number;

  /**
   * The time that execution of the current frame was started. See {@link World.execute} for
   * details.
   * @typedef {}
   */
  time: number;

  /**
   * The duration between the execution times of the current and previous frames.  See
   * {@link World.execute} for details.
   */
  delta: number;

  /**
   * This system's name, as used in error messages and stats reports.
   */
  get name(): string {return this.constructor.name;}

  // TODO: add an API for making immediate queries

  /**
   * Creates a persistent query for this system.  Can only be called from the constructor, typically
   * by initializing an instance property.
   *
   * Each query is automatically updated each frame immediately before the system executes.
   * @example
   * entities = this.query(q => q.all.with(ComponentFoo).write);
   * execute() {
   *   for (const entity of this.entities) {
   *     entity.write(ComponentFoo).bar += 1;
   *   }
   * }
   * @param buildCallback A function that builds the actual query using a small DSL.  See
   * {@link QueryBuilder} for the API.
   * @returns A live query that you can reference from the `execute` method.  It's also OK to read
   * a query from other attached systems, but note that it will only be updated prior to its host
   * system's execution.
   */
  query(buildCallback: (q: QueryBuilder) => void): Query {
    const query = new Query();
    const builder = new QueryBuilder(buildCallback, query);
    CHECK: if (!this.__queryBuilders) {
      throw new Error(
        `Attempt to create a new query after world initialized in system ${this.name}`);
    }
    this.__queryBuilders.push(builder);
    return query;
  }

  /**
   * Creates scheduling constraints for this system that will help determine its assignment to a
   * thread and the order of execution.  Can be called at most once, and only from the constructor,
   * typically by initializing an instance property.
   * @example
   * sked = this.schedule(s => s.beforeWritesTo(ComponentFoo).after(SystemBar));
   * @param buildCallback A function that constrains the schedule using a small DSL.  See
   * {@link ScheduleBuilder} for the API.
   * @returns A schedule placeholder object with no public API.
   */
  schedule(buildCallback: (s: ScheduleBuilder) => void): Schedule {
    CHECK: if (this.__scheduleBuilder === null) {
      throw new Error(`Attempt to define schedule after world initialized in system ${this.name}`);
    }
    CHECK: if (this.__scheduleBuilder) {
      throw new Error(`Attempt to define multiple schedules in system ${this.name}`);
    }
    const schedule = new Schedule();
    this.__scheduleBuilder = new ScheduleBuilder(buildCallback, schedule);
    return schedule;
  }

  singleton = {
    /**
     * Declares that the given component type is a singleton and gets a read-only handle to it. This
     * will automatically set the component's storage type to `compact` with a capacity of 1 and
     * create a new entity to hold all singleton components.  It's fine for many systems to request
     * access to the same singleton component, of course.  Can only be called from the constructor,
     * typically by initializing an instance property.
     * @example
     * foo = this.singleton.read(ComponentFoo);
     * @param type The component type to declare as a singleton.
     * @returns A read-only view of the only instance of the component.  This instance will remain
     *  valid for as long as the world exists.
     */
    read: <T>(type: ComponentType<T>): T => {
      CHECK: if (!this.__singletonPlaceholders) {
        throw new Error(
          `Attempt to declare a singleton after world initialized in system ${this.name}`);
      }
      declareSingleton(type);
      this.query(q => q.using(type));
      const placeholder = new SingletonPlaceholder('read', type);
      this.__singletonPlaceholders.push(placeholder);
      return placeholder as unknown as T;
    },

    /**
     * Declarse that the given component type is a singleton and gets a read-write handle to it.
     * This will automatically set the component's storage type to `compact` with a capacity of 1
     * and create a new entity to hold all singleton components.  It's fine for many systems to
     * request access to the same singleton component, but at most one can provide initial values
     * for it.  Can only be called from the constructor, typically by initializing an instance
     * property.
     * @example
     * foo = this.singleton.write(ComponentFoo, {value: 42});
     * @param type The component type to declare as a singleton.
     * @param initialValues Optional field values to initialize the component with.
     * @returns A read-write view of the only instance of the component.  This instance will remain
     *  valid for as long as the world exists.
     */
    write: <T>(type: ComponentType<T>, initialValues?: Record<string, unknown>): T => {
      CHECK: if (!this.__singletonPlaceholders) {
        throw new Error(
          `Attempt to declare a singleton after world initialized in system ${this.name}`);
      }
      declareSingleton(type);
      this.query(q => q.using(type).write);
      const placeholder = new SingletonPlaceholder('write', type, initialValues);
      this.__singletonPlaceholders.push(placeholder);
      return placeholder as unknown as T;
    }
  };

  /**
   * Creates a reference to another system in the world, that you can then use in your `initialize`
   * or `execute` methods.  Be careful not to abuse this feature as it will force all systems that
   * reference each other to be located in the same thread when using multithreading, possibly
   * limiting performance.  Can only be called from the constructor, typically by initializing an
   * instance property.
   * @example
   * foo = this.attach(SystemFoo);
   * @param systemType The type of the system to reference.
   * @returns The unique instance of the system of the given type that exists in the world.
   */
  attach<S extends System>(systemType: SystemType<S>): S {
    CHECK: if (!this.__attachPlaceholders) {
      throw new Error(`Attempt to attach a system after world initialized in system ${this.name}`);
    }
    const placeholder = new AttachPlaceholder(systemType);
    this.__attachPlaceholders.push(placeholder);
    return placeholder as unknown as S;
  }

  /**
   * Creates a new entity.  It works just like {@link World.createEntity} but returns the newly
   * created entity.  You *must not* retain a direct reference to the entity past the end of the
   * `execute` method.
   * @param initialComponents The types of the components to add to the new entity, optionally
   * interleaved with their initial properties.
   * @returns The newly created entity.
   */
  createEntity(...initialComponents: (ComponentType<any> | Record<string, unknown>)[]): Entity {
    return this.__dispatcher.createEntity(initialComponents);
  }

  /**
   * Enables or disables access to recently deleted data.  When turned on, you'll be able to read
   * components that were removed since the system's last execution, as well as references and
   * back references to entities deleted in the same time frame.
   * @param toggle Whether to turn access to recently deleted data on or off.
   */
  accessRecentlyDeletedData(toggle = true): void {
    this.__dispatcher.registry.includeRecentlyDeleted = toggle;
  }

  /**
   * Starts running a coroutine.  The coroutine will execute after each time this system does and
   * run until its next `yield` expression.  You can start coroutines anytime: from within
   * `initialize` or `execute`, from within a coroutine, or even from an event handler between
   * frames.  Coroutines started from within `execute` will begin running in the same frame.  The
   * execution order of coroutines within a system is unspecified and you should not depend on it.
   *
   * If you're using the {@link co} decorator you don't need call this method manually, it'll be
   * handled for you.
   *
   * Inside the coroutine, you can call methods on {@link co} to control the execution of the
   * coroutine.  You can `yield` on the result of the various `co.wait` methods, and also `yield`
   * directly on the result of starting another coroutine to wait for its returned value.
   *
   * @param generator The generator returned by a coroutine method.
   * @param coroutineFn The coroutine being started, to be used with
   *    {@link Coroutine.cancelIfCoroutineStarted}.
   * @returns A coroutine handle that you can use to control it.
   */
  start<CoFn extends CoroutineFunction>(coroutineFn: CoFn, ...args: Parameters<CoFn>): Coroutine {
    // TODO: disable coroutines if system is stateless
    return this.__supervisor.start(coroutineFn, ...args);
  }

  /**
   * Prepares any data or other structures needed by the system; to be implemented in a subclass and
   * invoked automatically precisely once when the world is created.  This method is not allowed to
   * create entities or access components.  Instead, it should set any needed data on the system's
   * properties to be used in `initialize`, which will be called afterwards.
   */
  async prepare(): Promise<void> { }  // eslint-disable-line @typescript-eslint/no-empty-function

  /**
   * Initializes the system; to be implemented in a subclass and invoked automatically precisely
   * once when the world is created and after the system has been prepared.  This method is allowed
   * to access the components as declared in the system's queries.
   */
  initialize(): void { } // eslint-disable-line @typescript-eslint/no-empty-function

  /**
   * Executes the system's function; to be implemented in a subclass and invoked automatically at
   * regular intervals.
   */
  execute(): void { } // eslint-disable-line @typescript-eslint/no-empty-function
}

export class SystemBox {
  readonly rwMasks: ReadWriteMasks = {read: [], write: []};
  readonly shapeQueries: QueryBox[] = [];
  readonly shapeQueriesByComponent: QueryBox[][] = [];
  readonly writeQueries: QueryBox[] = [];
  readonly writeQueriesByComponent: QueryBox[][] = [];
  hasNegativeQueries: boolean;
  hasWriteQueries: boolean;
  private hasTransientQueries: boolean;
  private ranQueriesLastFrame: boolean;
  private shapeLogPointer: LogPointer;
  private writeLogPointer?: LogPointer;
  private state: RunState = RunState.RUNNING;
  readonly stats: SystemStats;
  readonly attachedSystems: (SystemBox | undefined)[];
  readonly singletonComponentDefs: (ComponentType<any> | Record<string, unknown>)[];
  private propsAssigned = false;
  lane?: Lane;
  stateless = false;
  weight = 1;

  get id(): number {return this.system.id;}
  get name(): string {return this.system.name;}
  toString(): string {return this.name;}

  constructor(private readonly system: System, readonly dispatcher: Dispatcher) {
    system.__dispatcher = dispatcher;
    this.shapeLogPointer = dispatcher.shapeLog.createPointer();
    STATS: this.stats = dispatcher.stats.forSystem(system.constructor as SystemType<any>);
    this.attachedSystems = this.system.__attachPlaceholders!.map(
      placeholder => this.dispatcher.systemsByClass.get(placeholder.type));
    this.singletonComponentDefs = this.system.__singletonPlaceholders!.flatMap(placeholder => {
      return placeholder.initialValues ?
        [placeholder.type, placeholder.initialValues] : [placeholder.type];
    });
  }

  assignProps(props: Record<string, unknown>): void {
    if (this.propsAssigned) {
      throw new Error(`System ${this.name} has multiple props assigned in world defs`);
    }
    Object.assign(this.system, props);
    this.propsAssigned = true;
  }

  buildQueries(): void {
    for (const builder of this.system.__queryBuilders!) builder.__build(this);
    this.system.__queryBuilders = null;
    this.hasNegativeQueries = !!this.shapeQueriesByComponent[this.dispatcher.registry.Alive.id!];
    this.hasWriteQueries = !!this.writeQueries.length;
    this.hasTransientQueries = this.shapeQueries.some(query => query.hasTransientResults);
  }

  buildSchedule(): void {
    const staticScheduler = (this.system.constructor as SystemType<any>).__staticScheduler;
    if (staticScheduler) this.system.schedule(staticScheduler);
    this.system.__scheduleBuilder?.__build([this], `system ${this.name}`);
    this.system.__scheduleBuilder = null;
  }

  finishConstructing(): void {
    this.writeLogPointer = this.dispatcher.writeLog?.createPointer();
  }

  replacePlaceholders(): void {
    const openSystem = this.system as any;
    for (const prop in this.system) {
      const value = openSystem[prop];
      if (value instanceof AttachPlaceholder) {
        const targetSystemType = value.type;
        const targetSystem = this.dispatcher.systemsByClass.get(targetSystemType);
        CHECK: if (!targetSystem) {
          throw new Error(`Attached system ${targetSystemType.name} not defined in this world`);
        }
        openSystem[prop] = targetSystem.system;
      } else if (value instanceof SingletonPlaceholder) {
        openSystem[prop] = this.dispatcher.singleton![value.access](value.type);
      }
    }
    this.system.__attachPlaceholders = null;
    this.system.__singletonPlaceholders = null;
  }

  prepare(): Promise<void> {
    return this.system.prepare();
  }

  initialize(): void {
    this.system.initialize();
  }

  execute(time: number, delta: number): void {
    if (this.state !== RunState.RUNNING) return;
    this.system.time = time;
    this.system.delta = delta;
    let time1, time2, time3, time4;
    STATS: time1 = now();
    this.runQueries();
    STATS: time2 = now();
    this.system.execute();
    STATS: time3 = now();
    this.system.__supervisor.execute();
    STATS: time4 = now();
    STATS: {
      this.stats.lastQueryUpdateDuration = time2 - time1;
      this.stats.lastExecutionDuration = time3 - time2;
      this.stats.lastCoroutinesDuration = time4 - time3;
    }
  }

  private runQueries(): void {
    const ranQueriesLastFrame = this.ranQueriesLastFrame;
    this.ranQueriesLastFrame = false;
    const shapesChanged = this.dispatcher.shapeLog.hasUpdatesSince(this.shapeLogPointer);
    const writesMade =
      this.hasWriteQueries &&
      this.dispatcher.writeLog!.hasUpdatesSince(this.writeLogPointer!);
    if (shapesChanged || writesMade || this.hasTransientQueries && ranQueriesLastFrame) {
      if (this.hasTransientQueries) {
        // Every write query is a shape query too.
        for (const query of this.shapeQueries) query.clearTransientResults();
      }
      if (shapesChanged || writesMade) {
        this.ranQueriesLastFrame = true;
        if (shapesChanged) this.__updateShapeQueries();
        if (writesMade) this.__updateWriteQueries();
      }
    }
  }

  private __updateShapeQueries(): void {
    for (const query of this.shapeQueries) query.clearProcessedEntities();
    const shapeLog = this.dispatcher.shapeLog;
    let queries: QueryBox[] | undefined, runLength = 0;
    let log: Uint32Array | undefined, startIndex: number | undefined, endIndex: number | undefined;
    while (true) {
      [log, startIndex, endIndex] = shapeLog.processSince(this.shapeLogPointer);
      if (!log) break;
      if (runLength && !queries) {
        startIndex! += runLength;
        runLength = 0;
      }
      for (let i = startIndex!; i < endIndex!; i++) {
        const entry = log[i];
        const entityId = entry & ENTITY_ID_MASK;
        if (!queries) {
          const typeId = (entry >>> ENTITY_ID_BITS) & COMPONENT_ID_MASK;
          const runHeader = entry & 2 ** 31;
          queries = this.shapeQueriesByComponent[typeId];
          if (runHeader) {
            runLength = entityId;
            if (!queries) {
              const skip = Math.min(runLength, endIndex! - i);
              i += skip;
              runLength -= skip;
            }
            continue;
          }
          if (!queries) continue;
          runLength = 1;
        }
        DEBUG: if (entry & 2 ** 31) {
          throw new Error('Trying to process run header as entry in shape log');
        }
        for (let j = 0; j < queries.length; j++) queries[j].handleShapeUpdate(entityId);
        if (--runLength === 0) queries = undefined;
      }
    }
  }

  private __updateWriteQueries(): void {
    const writeLog = this.dispatcher.writeLog!;
    let queries: QueryBox[] | undefined, runLength = 0;
    let componentFlagOffset: number, componentFlagMask: number;
    let log: Uint32Array | undefined, startIndex: number | undefined, endIndex: number | undefined;
    while (true) {
      [log, startIndex, endIndex] = writeLog.processSince(this.writeLogPointer!);
      if (!log) break;
      if (runLength && !queries) {
        startIndex! += runLength;
        runLength = 0;
      }
      for (let i = startIndex!; i < endIndex!; i++) {
        const entry = log[i];
        const entityId = entry & ENTITY_ID_MASK;
        if (!queries) {
          const typeId = (entry >>> ENTITY_ID_BITS) & COMPONENT_ID_MASK;
          const runHeader = entry & 2 ** 31;
          // Manually recompute flag offset and mask instead of looking up component type.
          componentFlagOffset = typeId >> 5;
          componentFlagMask = 1 << (typeId & 31);
          queries = this.writeQueriesByComponent[typeId];
          if (runHeader) {
            runLength = entityId;
            if (!queries) {
              const skip = Math.min(runLength, endIndex! - i);
              i += skip;
              runLength -= skip;
            }
            continue;
          }
          if (!queries) continue;
          runLength = 1;
        }
        DEBUG: if (entry & 2 ** 31) {
          throw new Error('Trying to process run header as entry in write log');
        }
        for (let j = 0; j < queries.length; j++) {
          queries[j].handleWrite(entityId, componentFlagOffset!, componentFlagMask!);
        }
        if (--runLength === 0) queries = undefined;
      }
    }
  }

  stop(): void {
    if (this.state === RunState.STOPPED) return;
    this.state = RunState.STOPPED;
    for (const query of this.shapeQueries) query.clearAllResults();
  }

  restart(): void {
    if (this.state === RunState.STOPPED) {
      const registry = this.dispatcher.registry;
      const Alive = registry.Alive;
      for (const query of this.shapeQueries) query.clearProcessedEntities();
      for (let id = 0; id < this.dispatcher.maxEntities; id++) {
        if (registry.hasShape(id, Alive, false)) {
          for (const query of this.shapeQueries) query.handleShapeUpdate(id);
        }
      }
      for (const query of this.shapeQueries) query.clearTransientResults();
      this.dispatcher.shapeLog.createPointer(this.shapeLogPointer);
      this.dispatcher.writeLog?.createPointer(this.writeLogPointer!);
    }
    this.state = RunState.RUNNING;
  }
}
