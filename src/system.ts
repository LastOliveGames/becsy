import {Bitset, LogPointer} from './datastructures';
import type {Dispatcher} from './dispatcher';
import type {Entity, ReadWriteMasks} from './entity';
import {ENTITY_ID_BITS, ENTITY_ID_MASK} from './consts';
import {Query, QueryBox, QueryBuilder} from './query';
import type {ComponentType} from './component';


export interface SystemType<S extends System> {
  __system: true;
  new(): S;
}

type GroupContentsArray = (SystemType<System> | Record<string, unknown> | SystemGroup)[];

export const enum RunState {
  RUNNING, STOPPED
}

class Placeholder {
  constructor(readonly type: SystemType<System>) {}
}


export class SystemGroup {
  __systems: SystemBox[];
  __executed = false;

  constructor(readonly __contents: GroupContentsArray) { }

  __init(dispatcher: Dispatcher): void {
    for (const item of this.__contents) {
      if (item instanceof SystemGroup) item.__init(dispatcher);
    }
    this.__systems = [];
    for (const item of this.__contents) {
      if (item instanceof Function && item.__system) {
        this.__systems.push(dispatcher.systemsByClass.get(item)!);
      } else if (item instanceof SystemGroup) {
        this.__systems.push(...item.__systems);
      }
    }
    Object.freeze(this.__systems);
  }
}


export abstract class System {
  static readonly __system = true;

  static group(...systemTypes: GroupContentsArray): SystemGroup {
    return new SystemGroup(systemTypes);
  }

  __queryBuilders: QueryBuilder[] | null = [];
  __dispatcher: Dispatcher;
  time: number;
  delta: number;

  // TODO: support schedule builder

  get name(): string {return this.constructor.name;}

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

  attach<S extends System>(systemType: SystemType<S>): S {
    return new Placeholder(systemType) as unknown as S;
  }

  createEntity(...initialComponents: (ComponentType<any> | Record<string, unknown>)[]): Entity {
    return this.__dispatcher.createEntity(initialComponents);
  }

  accessRecentlyDeletedData(toggle = true): void {
    this.__dispatcher.registry.includeRecentlyDeleted = toggle;
  }

  initialize(): void | Promise<void> { } // eslint-disable-line @typescript-eslint/no-empty-function
  execute(): void { } // eslint-disable-line @typescript-eslint/no-empty-function
}

export class SystemBox {
  readonly rwMasks: ReadWriteMasks = {read: [], write: []};
  shapeQueries: QueryBox[] = [];
  writeQueries: QueryBox[] = [];
  hasWriteQueries: boolean;
  private processedEntities: Bitset;
  private shapeLogPointer: LogPointer;
  private writeLogPointer?: LogPointer;
  private state: RunState = RunState.RUNNING;

  get name(): string {return this.system.name;}

  constructor(private readonly system: System, readonly dispatcher: Dispatcher) {
    system.__dispatcher = dispatcher;
    this.shapeLogPointer = dispatcher.shapeLog.createPointer();
    this.writeLogPointer = dispatcher.writeLog?.createPointer();
    this.processedEntities = new Bitset(dispatcher.maxEntities);
    for (const builder of system.__queryBuilders!) builder.__build(this);
    system.__queryBuilders = null;
    this.hasWriteQueries = !!this.writeQueries.length;
  }

  replaceAttachmentPlaceholders(): void {
    for (const prop in this.system) {
      if ((this.system as any)[prop] instanceof Placeholder) {
        const targetSystemType = (this.system as any)[prop].type;
        const targetSystem = this.dispatcher.systemsByClass.get(targetSystemType);
        CHECK: if (!targetSystem) {
          throw new Error(`Attached system ${targetSystemType.name} not defined in this world`);
        }
        (this.system as any)[prop] = targetSystem;
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
    const shapesChanged = this.dispatcher.shapeLog.hasUpdatesSince(this.shapeLogPointer);
    const writesMade =
      this.hasWriteQueries &&
      this.dispatcher.writeLog!.hasUpdatesSince(this.writeLogPointer!);
    if (shapesChanged || writesMade) {
      this.processedEntities.clear();
      // Every write query is a shape query too.
      for (const query of this.shapeQueries) query.clearTransientResults();
      if (shapesChanged) this.__updateShapeQueries();
      if (writesMade) this.__updateWriteQueries();
    }
  }

  private __updateShapeQueries(): void {
    const shapeLog = this.dispatcher.shapeLog;
    let log: Uint32Array | undefined, startIndex: number | undefined, endIndex: number | undefined;
    while (true) {
      [log, startIndex, endIndex] = shapeLog.processSince(this.shapeLogPointer);
      if (!log) break;
      for (let i = startIndex!; i < endIndex!; i++) {
        const id = log[i];
        if (!this.processedEntities.get(id)) {
          this.processedEntities.set(id);
          for (const query of this.shapeQueries) query.handleShapeUpdate(id);
        }
      }
    }
  }

  private __updateWriteQueries(): void {
    const writeLog = this.dispatcher.writeLog!;
    let log: Uint32Array | undefined, startIndex: number | undefined, endIndex: number | undefined;
    while (true) {
      [log, startIndex, endIndex] = writeLog.processSince(this.writeLogPointer!);
      if (!log) break;
      for (let i = startIndex!; i < endIndex!; i++) {
        const entry = log[i];
        const entityId = entry & ENTITY_ID_MASK;
        if (!this.processedEntities.get(entityId)) {
          const componentId = entry >>> ENTITY_ID_BITS;
          for (const query of this.writeQueries) {
            // Manually recompute flag offset and mask instead of looking up component type.
            query.handleWrite(entityId, componentId >> 5, 1 << (componentId & 31));
          }
        }
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
