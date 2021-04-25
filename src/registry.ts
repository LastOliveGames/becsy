import {ComponentType, assimilateComponentType} from './component';
import {Log, LogPointer, Uint32Pool, UnsharedPool} from './datastructures';
import type {Dispatcher} from './dispatcher';
import {Entity, EntityId, ENTITY_ID_BITS, ENTITY_ID_MASK} from './entity';
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
      entity.__reset(id);
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
  private readonly shapes: Uint32Array;
  private readonly staleShapes: Uint32Array;
  private readonly entityIdPool: Uint32Pool;
  readonly pool: EntityPool;
  executingSystem: SystemBox | undefined;
  private readonly deletionLog: Log;
  private readonly prevDeletionPointer: LogPointer;
  private readonly oldDeletionPointer: LogPointer;
  private readonly removalLog: Log;
  private readonly prevRemovalPointer: LogPointer;
  private readonly oldRemovalPointer: LogPointer;

  constructor(
    maxEntities: number, maxLimboEntities: number, maxLimboComponents: number,
    readonly types: ComponentType<any>[], readonly dispatcher: Dispatcher
  ) {
    let componentId = 0;
    for (const type of types) assimilateComponentType(componentId++, type, this.dispatcher);
    this.stride = Math.ceil(types.length / 32);
    const size = maxEntities * this.stride * 4;
    this.shapes = new Uint32Array(new SharedArrayBuffer(size));
    this.staleShapes = new Uint32Array(new SharedArrayBuffer(size));
    this.entityIdPool = new UnsharedPool(maxEntities, 'maxEntities');
    this.entityIdPool.fillWithDescendingIntegers(0);
    this.pool = new EntityPool(this, maxEntities);
    this.deletionLog = new Log(maxLimboEntities, 'maxLimboEntities');
    this.prevDeletionPointer = this.deletionLog.createPointer();
    this.oldDeletionPointer = this.deletionLog.createPointer();
    this.removalLog = new Log(maxLimboComponents, 'maxLimboComponents');
    this.prevRemovalPointer = this.removalLog.createPointer();
    this.oldRemovalPointer = this.removalLog.createPointer();
  }

  createEntity(initialComponents: (ComponentType<any> | any)[]): Entity {
    const id = this.entityIdPool.take();
    this.shapes.fill(0, id * this.stride, (id + 1) * this.stride);
    // for (let i = id * this.stride; i < (id + 1) * this.stride; i++) this.shapes[i] = 0;
    const entity = this.pool.borrowTemporarily(id);
    if (initialComponents) entity.addAll(...initialComponents);
    STATS: this.dispatcher.stats.numEntities += 1;
    return entity;
  }

  queueDeletion(id: EntityId): void {
    this.deletionLog.push(id);
  }

  queueRemoval(id: EntityId, type: ComponentType<any>): void {
    this.removalLog.push(id | (type.id! << ENTITY_ID_BITS));
  }

  flush(): void {
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
        const shapeIndex = entityId * this.stride + type.__binding!.flagOffset;
        const mask = type.__binding!.flagMask;
        if ((this.shapes[shapeIndex] & mask) === 0) {
          this.staleShapes[shapeIndex] &= ~mask;
          type.__delete!(entityId);
        }
      }
      numRemovedComponents += endIndex! - startIndex!;
    }
    STATS: {
      this.dispatcher.stats.maxLimboComponents = numRemovedComponents;
    }
    this.removalLog.createPointer(this.prevRemovalPointer);
  }

  extendMaskAndSetFlag(mask: number[], type: ComponentType<any>): void {
    const flagOffset = type.__binding!.flagOffset!;
    if (flagOffset >= mask.length) {
      mask.length = flagOffset + 1;
      mask.fill(0, mask.length, flagOffset);
    }
    mask[flagOffset] |= type.__binding!.flagMask!;
  }

  maskHasFlag(mask: number[] | undefined, type: ComponentType<any>): boolean {
    return ((mask?.[type.__binding!.flagOffset] ?? 0) & type.__binding!.flagMask) !== 0;
  }

  hasFlag(id: EntityId, type: ComponentType<any>, allowRemoved = false): boolean {
    const shapeIndex = id * this.stride + type.__binding!.flagOffset;
    const mask = type.__binding!.flagMask;
    if ((this.shapes[shapeIndex] & mask) !== 0) return true;
    if (allowRemoved && (this.staleShapes[shapeIndex] & mask) !== 0) return true;
    return false;
  }

  setFlag(id: EntityId, type: ComponentType<any>): void {
    const shapeIndex = id * this.stride + type.__binding!.flagOffset;
    const mask = type.__binding!.flagMask;
    this.shapes[shapeIndex] |= mask;
    this.staleShapes[shapeIndex] |= mask;
    this.dispatcher.shapeLog.push(id);
  }

  clearFlag(id: EntityId, type: ComponentType<any>): void {
    this.shapes[id * this.stride + type.__binding!.flagOffset] &= ~type.__binding!.flagMask;
    this.dispatcher.shapeLog.push(id);
  }

  trackWrite(id: EntityId, type: ComponentType<any>): void {
    this.dispatcher.writeLog!.push(id | (type.id! << ENTITY_ID_BITS));
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
