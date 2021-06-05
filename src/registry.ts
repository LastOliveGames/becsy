import {ComponentType, assimilateComponentType, defineAndAllocateComponentType} from './component';
import {Log, LogPointer, SharedAtomicPool, Uint32Pool, UnsharedPool} from './datastructures';
import type {Dispatcher} from './dispatcher';
import {Entity, EntityId} from './entity';
import {ENTITY_ID_BITS, ENTITY_ID_MASK} from './consts';
import type {SystemBox} from './system';


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
  private readonly stride: number;
  private shapes: Uint32Array;
  private staleShapes: Uint32Array;
  private readonly entityIdPool: Uint32Pool;
  readonly pool: EntityPool;
  executingSystem?: SystemBox;
  includeRecentlyDeleted = false;
  private readonly deletionLog: Log;
  private readonly prevDeletionPointer: LogPointer;
  private readonly oldDeletionPointer: LogPointer;
  private readonly removalLog: Log;
  private readonly prevRemovalPointer: LogPointer;
  private readonly oldRemovalPointer: LogPointer;
  readonly Alive = class Alive {};

  constructor(
    maxEntities: number, maxLimboEntities: number, maxLimboComponents: number,
    readonly types: ComponentType<any>[], readonly dispatcher: Dispatcher
  ) {
    this.stride = Math.ceil(types.length / 32);
    const length = maxEntities * this.stride;
    dispatcher.buffers.register(
      'registry.shapes', length, Uint32Array, shapes => {this.shapes = shapes;});
    dispatcher.buffers.register(
      'registry.staleShapes', length, Uint32Array,
      staleShapes => {this.staleShapes = staleShapes;});
    this.entityIdPool = dispatcher.threaded ?
      new SharedAtomicPool(maxEntities, 'maxEntities', dispatcher.buffers) :
      new UnsharedPool(maxEntities, 'maxEntities');
    this.entityIdPool.fillWithDescendingIntegers(0);
    this.pool = new EntityPool(this, maxEntities);
    this.deletionLog = new Log(maxLimboEntities, 'maxLimboEntities', dispatcher.buffers);
    this.prevDeletionPointer = this.deletionLog.createPointer();
    this.oldDeletionPointer = this.deletionLog.createPointer();
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

  createEntity(initialComponents: (ComponentType<any> | any)[]): Entity {
    const id = this.entityIdPool.take();
    const shapesIndex = id * this.stride;
    this.shapes[shapesIndex] = 1;
    if (this.stride > 1) this.shapes.fill(0, shapesIndex + 1, shapesIndex + this.stride);
    const entity = this.pool.borrowTemporarily(id);
    if (initialComponents) entity.addAll(...initialComponents);
    STATS: this.dispatcher.stats.numEntities += 1;
    return entity;
  }

  queueDeletion(id: EntityId): void {
    this.deletionLog.push(id);
  }

  flush(): void {
    this.includeRecentlyDeleted = false;
    this.pool.returnTemporaryBorrows();
    this.deletionLog.commit();
    this.removalLog.commit();
  }

  processEndOfFrame(): void {
    this.processDeletionLog();
    this.processRemovalLog();
  }

  private processDeletionLog(): void {
    this.deletionLog.commit();
    let numDeletedEntities = 0;
    let log: Uint32Array | undefined, startIndex: number | undefined, endIndex: number | undefined;
    while (true) {
      [log, startIndex, endIndex] =
        this.deletionLog.processSince(this.oldDeletionPointer, this.prevDeletionPointer);
      if (!log) break;
      for (let i = startIndex!; i < endIndex!; i++) {
        this.dispatcher.indexer.clearAllRefs(log[i], true);
      }
      const segment = log.subarray(startIndex, endIndex);
      this.entityIdPool.refill(segment);
      numDeletedEntities += segment.length;
    }
    STATS: {
      this.dispatcher.stats.numEntities -= numDeletedEntities;
      this.dispatcher.stats.maxLimboEntities = numDeletedEntities;
    }
    this.deletionLog.createPointer(this.prevDeletionPointer);
  }

  private processRemovalLog(): void {
    this.removalLog.commit();
    let numRemovedComponents = 0;
    let log: Uint32Array | undefined, startIndex: number | undefined, endIndex: number | undefined;
    while (true) {
      [log, startIndex, endIndex] =
        this.removalLog.processSince(this.oldRemovalPointer, this.prevRemovalPointer);
      if (!log) break;
      for (let i = startIndex!; i < endIndex!; i++) {
        const entry = log[i];
        const entityId = entry & ENTITY_ID_MASK;
        const componentId = entry >>> ENTITY_ID_BITS;
        const type = this.types[componentId];
        const shapeIndex = entityId * this.stride + type.__binding!.shapeOffset;
        const mask = type.__binding!.shapeMask;
        // TODO: somehow check that the component wasn't resurrected and then removed again in the
        // next frame, or we'll finalize the removal too early!
        if ((this.shapes[shapeIndex] & mask) === 0) {
          this.staleShapes[shapeIndex] &= ~mask;
          this.clearRefs(entityId, type, true);
          type.__free?.(entityId);
        }
      }
      numRemovedComponents += endIndex! - startIndex!;
    }
    STATS: {
      this.dispatcher.stats.maxLimboComponents = numRemovedComponents;
    }
    this.removalLog.createPointer(this.prevRemovalPointer);
  }

  hasShape(id: EntityId, type: ComponentType<any>, allowRecentlyDeleted: boolean): boolean {
    const shapeIndex = id * this.stride + type.__binding!.shapeOffset;
    const mask = type.__binding!.shapeMask;
    if ((this.shapes[shapeIndex] & mask) !== 0) return true;
    if (allowRecentlyDeleted && this.includeRecentlyDeleted &&
        (this.staleShapes[shapeIndex] & mask) !== 0) return true;
    return false;
  }

  setShape(id: EntityId, type: ComponentType<any>): void {
    const shapeIndex = id * this.stride + type.__binding!.shapeOffset;
    const mask = type.__binding!.shapeMask;
    this.shapes[shapeIndex] |= mask;
    this.staleShapes[shapeIndex] |= mask;
    this.dispatcher.shapeLog.push(id);
  }

  clearShape(id: EntityId, type: ComponentType<any>): void {
    const hasRefs = this.clearRefs(id, type, false);
    if (type.__free || hasRefs) this.removalLog.push(id | (type.id! << ENTITY_ID_BITS));
    this.shapes[id * this.stride + type.__binding!.shapeOffset] &= ~type.__binding!.shapeMask;
    this.dispatcher.shapeLog.push(id);
    STATS: this.dispatcher.stats.for(type).numEntities -= 1;
  }

  trackWrite(id: EntityId, type: ComponentType<any>): void {
    this.dispatcher.writeLog!.push(id | (type.id! << ENTITY_ID_BITS));
  }

  private clearRefs(id: EntityId, type: ComponentType<any>, final: boolean): boolean {
    const hasRefs = !!type.__binding!.refFields.length;
    if (hasRefs) {
      type.__bind!(id, true);
      for (const field of type.__binding!.refFields) field.clearRef!(final);
    }
    return hasRefs;
  }

  matchShape(id: EntityId, positiveMask?: number[], negativeMask?: number[]): boolean {
    const offset = id * this.stride;
    if (positiveMask) {
      for (let i = 0; i < positiveMask.length; i++) {
        const maskByte = positiveMask[i];
        if ((this.shapes[offset + i] & maskByte) !== maskByte) return false;
      }
    }
    if (negativeMask) {
      for (let i = 0; i < negativeMask.length; i++) {
        const maskByte = negativeMask[i];
        if ((this.shapes[offset + i] & maskByte) !== 0) return false;
      }
    }
    return true;
  }
}
