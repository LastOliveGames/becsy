import type {ComponentType} from './component';
import {Bitset, LogPointer} from './datastructures';
import type {Dispatcher} from './dispatcher';
import type {Entity, ReadWriteMasks} from './entity';
import {ENTITY_ID_BITS, ENTITY_ID_MASK} from './consts';
import {Query, QueryBox, QueryBuilder} from './query';


export interface SystemType {
  new(): System;
}


export abstract class System {
  static __system = true;
  __queryBuilders: QueryBuilder[] | null = [];
  __dispatcher: Dispatcher;
  time: number;
  delta: number;

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

  createEntity(...initialComponents: (ComponentType<any> | any)[]): Entity {
    return this.__dispatcher.createEntity(initialComponents);
  }

  abstract execute(): void;
}

export class SystemBox {
  readonly rwMasks: ReadWriteMasks = {read: [], write: []};
  shapeQueries: QueryBox[] = [];
  writeQueries: QueryBox[] = [];
  hasWriteQueries: boolean;
  private processedEntities: Bitset;
  private shapeLogPointer: LogPointer;
  private writeLogPointer: LogPointer | undefined;

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

  execute(time: number, delta: number): void {
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
}
