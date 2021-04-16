import type {ComponentType} from './component';
import {Bitset, LogPointer} from './datastructures';
import type {Dispatcher} from './dispatcher';
import {Entity, ENTITY_ID_BITS, ENTITY_ID_MASK, ReadWriteMasks} from './entity';
import {TopQuery, TopQueryBuilder} from './query';


export interface SystemType {
  new(): System;
}


export abstract class System {
  readonly __rwMasks: ReadWriteMasks = {read: [], write: []};
  __dispatcher: Dispatcher;
  private __queryBuilders: TopQueryBuilder[] | null = [];
  __shapeQueries: TopQuery[] = [];
  __writeQueries: TopQuery[] = [];
  __hasWriteQueries: boolean;
  private __processedEntities: Bitset;
  __removedEntities: Bitset;
  private __shapeLogPointer: LogPointer;
  private __writeLogPointer: LogPointer | undefined;
  time: number;
  delta: number;

  get name(): string {return this.constructor.name;}

  query(buildCallback: (q: TopQueryBuilder) => void): TopQuery {
    const query = new TopQuery(this);
    const builder = new TopQueryBuilder(buildCallback, query, this);
    if (!this.__queryBuilders) {
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

  __init(dispatcher: Dispatcher): void {
    if (dispatcher === this.__dispatcher) return;
    if (this.__dispatcher) {
      throw new Error(`You can't reuse an instance of system ${this.name} in different worlds`);
    }
    this.__dispatcher = dispatcher;
    this.__shapeLogPointer = dispatcher.shapeLog.createPointer();
    this.__writeLogPointer = dispatcher.writeLog?.createPointer();
    this.__processedEntities = new Bitset(dispatcher.maxEntities);
    this.__removedEntities = new Bitset(dispatcher.maxEntities);
    for (const builder of this.__queryBuilders!) builder.__build();
    this.__queryBuilders = null;
    this.__hasWriteQueries = !!this.__writeQueries.length;
  }

  __runQueries(): void {
    const shapesChanged = this.__dispatcher.shapeLog.hasUpdatesSince(this.__shapeLogPointer);
    const writesMade =
      this.__hasWriteQueries &&
      this.__dispatcher.writeLog!.hasUpdatesSince(this.__writeLogPointer!);
    if (shapesChanged || writesMade) {
      this.__processedEntities.clear();
      // Every write query is a shape query too.
      for (const query of this.__shapeQueries) query.__clearTransientResults();
      if (shapesChanged) this.__updateShapeQueries();
      if (writesMade) this.__updateWriteQueries();
    }
  }

  private __updateShapeQueries(): void {
    const shapeLog = this.__dispatcher.shapeLog;
    let log: Uint32Array | undefined, startIndex: number | undefined, endIndex: number | undefined;
    while (true) {
      [log, startIndex, endIndex] = shapeLog.processSince(this.__shapeLogPointer);
      if (!log) break;
      for (let i = startIndex!; i < endIndex!; i++) {
        const id = log[i];
        if (!this.__processedEntities.get(id)) {
          this.__processedEntities.set(id);
          for (const query of this.__shapeQueries) query.__updateShape(id);
        }
      }
    }
  }

  private __updateWriteQueries(): void {
    const writeLog = this.__dispatcher.writeLog!;
    let log: Uint32Array | undefined, startIndex: number | undefined, endIndex: number | undefined;
    while (true) {
      [log, startIndex, endIndex] = writeLog.processSince(this.__writeLogPointer!);
      if (!log) break;
      for (let i = startIndex!; i < endIndex!; i++) {
        const entry = log[i];
        const entityId = entry & ENTITY_ID_MASK;
        if (!this.__processedEntities.get(entityId)) {
          const componentId = entry >>> ENTITY_ID_BITS;
          for (const query of this.__writeQueries) {
            // Manually recompute flag offset and mask instead of looking up component type.
            query.__handleWrite(entityId, componentId >> 5, 1 << (componentId & 31));
          }
        }
      }
    }
  }
}
