import type {LogPointer} from './datatypes/log';
import type {Dispatcher} from './dispatcher';
import type {Entity, ReadWriteMasks} from './entity';
import {COMPONENT_ID_MASK, ENTITY_ID_BITS, ENTITY_ID_MASK} from './consts';
import type {World} from './world';  // eslint-disable-line @typescript-eslint/no-unused-vars
import {Query, QueryBox, QueryBuilder} from './query';
import type {ComponentType} from './component';
import {
  GroupContentsArray, Schedule, ScheduleBuilder, SystemGroup, SystemGroupImpl
} from './schedules';


export interface SystemType<S extends System> {
  __system: true;
  new(): S;
}


export enum RunState {
  RUNNING, STOPPED
}

class Placeholder {
  constructor(readonly type: SystemType<System>) {}
}


/**
 * An encapsulated piece of functionality for your app that executes every frame, typically by
 * iterating over some components returned by a query.
 *
 * You should subclass and implement {@link System.execute} at a minimum, but take a look at the
 * other methods as well.
 */
export abstract class System {
  static readonly __system = true;

  // TODO: document
  static group(...systemTypes: GroupContentsArray): SystemGroup {
    return new SystemGroupImpl(systemTypes);
  }

  __queryBuilders: QueryBuilder[] | null = [];
  __scheduleBuilder: ScheduleBuilder | undefined | null;
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

  /**
   * Creates a reference to another system in the world, that you can then use in your `initialize`
   * or `execute` methods.  Be careful not to abuse this feature as it will force all systems that
   * reference each other to be located in the same thread when using multithreading, possibly
   * limiting performance.
   * @example
   * foo = this.attach(SystemFoo);
   * @param systemType The type of the system to reference.
   * @returns The unique instance of the system of the given type that exists in the world.
   */
  attach<S extends System>(systemType: SystemType<S>): S {
    return new Placeholder(systemType) as unknown as S;
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
   * Initializes the system; to be implemented in a subclass and invoked automatically precisely
   * once when the world is created.  If the method returns a promise world creation will block
   * until it's resolved.
   */
  initialize(): void | Promise<void> { } // eslint-disable-line @typescript-eslint/no-empty-function

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

  get id(): number {return this.system.id;}
  get name(): string {return this.system.name;}
  toString(): string {return this.name;}

  constructor(private readonly system: System, readonly dispatcher: Dispatcher) {
    system.__dispatcher = dispatcher;
    this.shapeLogPointer = dispatcher.shapeLog.createPointer();
  }

  buildQueries(): void {
    for (const builder of this.system.__queryBuilders!) builder.__build(this);
    this.system.__queryBuilders = null;
    this.hasNegativeQueries = !!this.shapeQueriesByComponent[this.dispatcher.registry.Alive.id!];
    this.hasWriteQueries = !!this.writeQueries.length;
    this.hasTransientQueries = this.shapeQueries.some(query => query.hasTransientResults);
  }

  buildSchedule(): void {
    this.system.__scheduleBuilder?.__build([this], `system ${this.name}`);
    this.system.__scheduleBuilder = null;
  }

  finishConstructing(): void {
    this.writeLogPointer = this.dispatcher.writeLog?.createPointer();
    this.replaceAttachmentPlaceholders();
  }

  private replaceAttachmentPlaceholders(): void {
    for (const prop in this.system) {
      if ((this.system as any)[prop] instanceof Placeholder) {
        const targetSystemType = (this.system as any)[prop].type;
        const targetSystem = this.dispatcher.systemsByClass.get(targetSystemType);
        CHECK: if (!targetSystem) {
          throw new Error(`Attached system ${targetSystemType.name} not defined in this world`);
        }
        (this.system as any)[prop] = targetSystem.system;
      }
    }
  }

  async initialize(): Promise<void> {
    await Promise.resolve(this.system.initialize());
  }

  execute(time: number, delta: number): void {
    if (this.state !== RunState.RUNNING) return;
    this.system.time = time;
    this.system.delta = delta;
    this.runQueries();
    this.system.execute();
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
