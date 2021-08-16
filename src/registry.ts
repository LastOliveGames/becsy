import {ComponentType, assimilateComponentType, defineAndAllocateComponentType} from './component';
import {Log, LogPointer} from './datatypes/log';
import {SharedAtomicPool, Uint32Pool, UnsharedPool} from './datatypes/intpool';
import type {Dispatcher} from './dispatcher';
import {Entity, EntityId} from './entity';
import {COMPONENT_ID_MASK, ENTITY_ID_BITS, ENTITY_ID_MASK} from './consts';
import type {SystemBox} from './system';
import {AtomicSharedShapeArray, ShapeArray, UnsharedShapeArray} from './datatypes/shapearray';


export class EntityPool {
  private readonly borrowed: (Entity | undefined)[];  // indexed by id
  private readonly borrowCounts: Int32Array;  // indexed by id
  private readonly spares: Entity[] = [];
  private readonly temporarilyBorrowedIds: number[] = [];

  constructor(private readonly registry: Registry, maxEntities: number) {
    this.borrowed = Array.from({length: maxEntities});
    this.borrowCounts = new Int32Array(maxEntities);
  }

  borrow(id: number): Entity {
    this.borrowCounts[id] += 1;
    let entity = this.borrowed[id];
    if (!entity) {
      entity = this.borrowed[id] = this.spares.pop() ?? new Entity(this.registry);
      entity.__id = id;
    }
    return entity;
  }

  borrowTemporarily(id: number): Entity {
    const entity = this.borrow(id);
    this.temporarilyBorrowedIds.push(id);
    return entity;
  }

  returnTemporaryBorrows(): void {
    for (const id of this.temporarilyBorrowedIds) this.return(id);
    this.temporarilyBorrowedIds.splice(0, Infinity);
  }

  return(id: number): void {
    DEBUG: {
      if (!this.borrowCounts[id]) {
        throw new Error('Internal error, returning entity with no borrows');
      }
    }
    if (--this.borrowCounts[id] <= 0) {
      this.spares.push(this.borrowed[id]!);
      this.borrowed[id] = undefined;
    }
  }
}


export class Registry {
  private readonly shapes: ShapeArray;
  private readonly staleShapes: ShapeArray;
  private readonly removedShapes: ShapeArray;
  private readonly entityIdPool: Uint32Pool;
  readonly pool: EntityPool;
  executingSystem?: SystemBox;
  includeRecentlyDeleted = false;
  hasNegativeQueries = false;
  private readonly removalLog: Log;
  private readonly prevRemovalPointer: LogPointer;
  private readonly oldRemovalPointer: LogPointer;
  readonly Alive: ComponentType<any> = class Alive {};

  constructor(
    maxEntities: number, maxLimboComponents: number, readonly types: ComponentType<any>[],
    readonly dispatcher: Dispatcher
  ) {
    const ShapeArrayClass = dispatcher.threaded ? AtomicSharedShapeArray : UnsharedShapeArray;
    this.shapes = new ShapeArrayClass(
      'registry.shapes', types.length, maxEntities, dispatcher.buffers);
    this.staleShapes = new ShapeArrayClass(
      'registry.staleShapes', types.length, maxEntities, dispatcher.buffers);
    this.removedShapes = new ShapeArrayClass(
      'registry.removedShapes', types.length, maxEntities, dispatcher.buffers);
    this.entityIdPool = dispatcher.threaded ?
      new SharedAtomicPool(maxEntities, 'maxEntities', dispatcher.buffers) :
      new UnsharedPool(maxEntities, 'maxEntities');
    this.entityIdPool.fillWithDescendingIntegers(0);
    this.pool = new EntityPool(this, maxEntities);
    this.removalLog = new Log(maxLimboComponents, 'maxLimboComponents', dispatcher.buffers);
    this.prevRemovalPointer = this.removalLog.createPointer();
    this.oldRemovalPointer = this.removalLog.createPointer();
  }

  initializeComponentTypes(): void {
    this.types.unshift(this.Alive);
    let componentId = 0;
    // Two-phase init, so components can have dependencies on each other's fields.
    for (const type of this.types) assimilateComponentType(componentId++, type, this.dispatcher);
    for (const type of this.types) defineAndAllocateComponentType(type);
    DEBUG: {
      const aliveBinding = this.types[0].__binding!;
      if (!(aliveBinding.shapeOffset === 0 && aliveBinding.shapeMask === 1)) {
        throw new Error('Alive component was not assigned first available shape mask');
      }
    }
  }

  createEntity(initialComponents: (ComponentType<any> | Record<string, unknown>)[]): Entity {
    const id = this.entityIdPool.take();
    this.setShape(id, this.Alive);
    const entity = this.pool.borrowTemporarily(id);
    entity.addAll(...initialComponents);
    STATS: this.dispatcher.stats.numEntities += 1;
    return entity;
  }

  flush(): void {
    this.includeRecentlyDeleted = false;
    this.pool.returnTemporaryBorrows();
    this.removalLog.commit();
  }

  completeCycle(): void {
    this.processRemovalLog();
  }

  private processRemovalLog(): void {
    const indexer = this.dispatcher.indexer;
    this.removalLog.commit();
    let numDeletedEntities = 0;
    let log: Uint32Array | undefined, startIndex: number | undefined, endIndex: number | undefined;

    STATS: {
      this.dispatcher.stats.maxLimboComponents =
        this.removalLog.countSince(this.removalLog.copyPointer(this.oldRemovalPointer));
    }
    while (true) {
      [log, startIndex, endIndex] =
        this.removalLog.processSince(this.oldRemovalPointer, this.prevRemovalPointer);
      if (!log) break;
      for (let i = startIndex!; i < endIndex!; i++) {
        const entry = log[i];
        const entityId = entry & ENTITY_ID_MASK;
        const componentId = (entry >>> ENTITY_ID_BITS) & COMPONENT_ID_MASK;
        const type = this.types[componentId];
        if (!this.shapes.isSet(entityId, type) && !this.removedShapes.isSet(entityId, type)) {
          this.staleShapes.unset(entityId, type);
          if (type === this.Alive) {
            indexer.clearAllRefs(entityId, true);
            this.entityIdPool.return(entityId);
            STATS: numDeletedEntities += 1;
          } else {
            this.clearRefs(entityId, type, true);
          }
          type.__free?.(entityId);
        }
      }
    }
    STATS: this.dispatcher.stats.numEntities -= numDeletedEntities;
    this.removedShapes.clear();
    this.removalLog.createPointer(this.prevRemovalPointer);
  }

  hasShape(id: EntityId, type: ComponentType<any>, allowRecentlyDeleted: boolean): boolean {
    if (this.shapes.isSet(id, type)) return true;
    if (allowRecentlyDeleted && this.includeRecentlyDeleted &&
        this.staleShapes.isSet(id, type)) return true;
    return false;
  }

  setShape(id: EntityId, type: ComponentType<any>): void {
    this.shapes.set(id, type);
    this.staleShapes.set(id, type);
    if (type !== this.Alive || this.hasNegativeQueries) {
      this.dispatcher.shapeLog.push(id | (type.id! << ENTITY_ID_BITS), type);
    }
  }

  clearShape(id: EntityId, type: ComponentType<any>): void {
    this.clearRefs(id, type, false);
    this.shapes.unset(id, type);
    this.removedShapes.set(id, type);
    const logEntry = id | (type.id! << ENTITY_ID_BITS);
    this.removalLog.push(logEntry);
    if (type !== this.Alive || this.hasNegativeQueries) {
      this.dispatcher.shapeLog.push(logEntry, type);
    }
    STATS: this.dispatcher.stats.for(type).numEntities -= 1;
  }

  trackWrite(id: EntityId, type: ComponentType<any>): void {
    this.dispatcher.writeLog!.push(id | (type.id! << ENTITY_ID_BITS), type);
  }

  private clearRefs(id: EntityId, type: ComponentType<any>, final: boolean): void {
    const hasRefs = !!type.__binding!.refFields.length;
    if (hasRefs) {
      type.__bind!(id, true);
      for (const field of type.__binding!.refFields) field.clearRef!(final);
    }
  }

  matchShape(id: EntityId, positiveMask?: number[], negativeMask?: number[]): boolean {
    if (positiveMask && !this.shapes.match(id, positiveMask)) return false;
    if (negativeMask && !this.shapes.matchNot(id, negativeMask)) return false;
    return true;
  }
}
