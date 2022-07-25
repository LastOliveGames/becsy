import {
  ComponentType, assimilateComponentType, defineAndAllocateComponentType, ComponentId,
  dissimilateComponentType,
  initComponent,
  checkTypeDefined,
  Component
} from './component';
import {ComponentEnum} from './enums';
import {Log, LogPointer} from './datatypes/log';
import {SharedAtomicPool, Uint32Pool, UnsharedPool} from './datatypes/intpool';
import type {Dispatcher} from './dispatcher';
import {Entity, EntityId, EntityImpl} from './entity';
import {COMPONENT_ID_MASK, ENTITY_ID_BITS, ENTITY_ID_MASK} from './consts';
import type {SystemBox} from './system';
import {AtomicSharedShapeArray, ShapeArray, UnsharedShapeArray} from './datatypes/shapearray';
import {CheckError, InternalError} from './errors';


const SYSTEM_ERROR_TYPES = [
  EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError, AggregateError,
  CheckError, InternalError
];


export class EntityPool {
  private readonly borrowed: (Entity | undefined)[];  // indexed by id
  private readonly borrowCounts: Int32Array;  // indexed by id
  private readonly spares: Entity[] = [];
  private readonly temporarilyBorrowedIds: EntityId[] = [];

  constructor(private readonly registry: Registry, maxEntities: number) {
    this.borrowed = Array.from({length: maxEntities});
    this.borrowCounts = new Int32Array(maxEntities);
  }

  borrow(id: EntityId): Entity {
    this.borrowCounts[id] += 1;
    let entity = this.borrowed[id];
    if (!entity) {
      entity = this.borrowed[id] = this.spares.pop() ?? new EntityImpl(this.registry);
      entity.__id = id;
    }
    return entity;
  }

  borrowTemporarily(id: EntityId): Entity {
    const entity = this.borrow(id);
    this.temporarilyBorrowedIds.push(id);
    return entity;
  }

  returnTemporaryBorrows(): void {
    for (const id of this.temporarilyBorrowedIds) this.return(id);
    this.temporarilyBorrowedIds.length = 0;
  }

  return(id: EntityId): void {
    DEBUG: {
      if (!this.borrowCounts[id]) {
        throw new InternalError('Returning entity with no borrows');
      }
    }
    if (--this.borrowCounts[id] <= 0) {
      const entity = this.borrowed[id]!;
      this.borrowed[id] = undefined;
      CHECK: {
        entity.__valid = false;
        return;
      }
      this.spares.push(entity);
    }
  }
}


type AllocationItem = {typeOrEnum: ComponentType<Component> | ComponentEnum, size: number};

export class Registry {
  private readonly allocationItems: AllocationItem[];
  private readonly numShapeBits: number = 0;
  private readonly shapes: ShapeArray;
  private readonly staleShapes: ShapeArray;
  private readonly removedShapes: ShapeArray;
  private readonly entityIdPool: Uint32Pool;
  readonly pool: EntityPool;
  private readonly heldEntities: Entity[];
  private readonly validators: ComponentType<any>[];
  private readonly reshapedEntityIds: EntityId[] = [];
  validateSystem: SystemBox;
  executingSystem?: SystemBox;
  includeRecentlyDeleted = false;
  hasNegativeQueries = false;
  nextEntityOrdinal = 0;
  entityOrdinals: Uint32Array;
  private readonly removalLog: Log;
  private readonly prevRemovalPointer: LogPointer;
  private readonly oldRemovalPointer: LogPointer;
  readonly Alive: ComponentType<any> = class Alive {};

  constructor(
    maxEntities: number, maxLimboComponents: number, readonly types: ComponentType<any>[],
    readonly enums: ComponentEnum[], readonly dispatcher: Dispatcher
  ) {
    this.allocationItems = this.prepareComponentTypesAndEnums();
    for (const item of this.allocationItems) this.numShapeBits += item.size;
    const ShapeArrayClass = dispatcher.threaded ? AtomicSharedShapeArray : UnsharedShapeArray;
    this.shapes = new ShapeArrayClass(
      'registry.shapes', this.numShapeBits, maxEntities, dispatcher.buffers);
    this.staleShapes = new ShapeArrayClass(
      'registry.staleShapes', this.numShapeBits, maxEntities, dispatcher.buffers);
    this.removedShapes = new ShapeArrayClass(
      'registry.removedShapes', this.numShapeBits, maxEntities, dispatcher.buffers);
    this.entityIdPool = dispatcher.threaded ?
      new SharedAtomicPool(maxEntities, 'maxEntities', dispatcher.buffers) :
      new UnsharedPool(maxEntities, 'maxEntities');
    this.entityOrdinals = dispatcher.buffers.register(
      'registry.entityOrdinals', maxEntities, Uint32Array, array => {this.entityOrdinals = array;});
    this.entityIdPool.fillWithDescendingIntegers(0);
    this.pool = new EntityPool(this, maxEntities);
    CHECK: this.heldEntities = [];
    CHECK: this.validators = [];
    this.removalLog = new Log(maxLimboComponents, 'maxLimboComponents', dispatcher.buffers);
    this.prevRemovalPointer = this.removalLog.createPointer();
    this.oldRemovalPointer = this.removalLog.createPointer();
  }

  initializeComponentTypes(): void {
    // Two-phase init, so components can have dependencies on each other's fields.
    let bitIndex = 0, typeId = 0;
    while (this.allocationItems.length) {
      const shift = bitIndex % 32;
      const item = this.removeBiggestNoLargerThan(32 - shift);
      if (!item) {
        bitIndex += 32 - shift;
        continue;
      }
      const shapeSpec = {
        offset: bitIndex >>> 5, mask: ((1 << item.size) - 1) << shift, value: 1 << shift
      };
      bitIndex += item.size;
      if (item.typeOrEnum instanceof ComponentEnum) {
        const enumeration = item.typeOrEnum;
        enumeration.__binding = {
          shapeOffset: shapeSpec.offset, shapeMask: shapeSpec.mask, shapeShift: shift
        };
        for (const type of enumeration.__types) {
          assimilateComponentType(typeId++ as ComponentId, type, shapeSpec, this.dispatcher);
          CHECK: if (type.validate) this.validators.push(type);
          shapeSpec.value += 1 << shift;
        }
      } else {
        const type = item.typeOrEnum;
        assimilateComponentType(typeId++ as ComponentId, type, shapeSpec, this.dispatcher);
        CHECK: if (type.validate) this.validators.push(type);
      }
    }

    for (const type of this.types) defineAndAllocateComponentType(type);

    DEBUG: {
      const aliveBinding = this.Alive.__binding!;
      if (!(aliveBinding.shapeOffset === 0 && aliveBinding.shapeMask === 1 &&
            aliveBinding.shapeValue === 1)) {
        throw new InternalError('Alive component was not assigned first available shape mask');
      }
    }
  }

  private prepareComponentTypesAndEnums(): AllocationItem[] {
    const pool: AllocationItem[] = [];
    const enumTypes = new Set<ComponentType<Component>>();
    for (const type of this.types) {
      if (type.enum) {
        CHECK: if (!this.enums.includes(type.enum)) {
          throw new CheckError(
            `Component type ${type.name} references an enum that's not in the world's defs`);
        }
        if (!type.enum.__types.includes(type)) type.enum.__types.push(type);
      }
    }
    for (const enumeration of this.enums) {
      CHECK: if (enumeration.__types.length > 2 ** 31) {
        throw new CheckError(`Too many types in enum: ${enumeration.__types.length}`);
      }
      pool.push({typeOrEnum: enumeration, size: Math.ceil(Math.log2(enumeration.__types.length))});
      for (const type of enumeration.__types) {
        CHECK: if (enumTypes.has(type)) {
          throw new CheckError(`Component type ${type.name} is a member of more than one enum`);
        }
        type.enum = enumeration;
        enumTypes.add(type);
      }
    }
    for (const type of this.types) {
      if (!enumTypes.has(type)) pool.push({typeOrEnum: type, size: 1});
    }
    pool.sort((a, b) => b.size - a.size);
    // Ensure that Alive will always be the first type allocated.
    this.types.unshift(this.Alive);
    pool.unshift({typeOrEnum: this.Alive, size: 1});
    return pool;
  }

  private removeBiggestNoLargerThan(maxSize: number): AllocationItem | undefined {
    const k = this.allocationItems.findIndex(item => item.size <= maxSize);
    if (k === -1) return;
    return this.allocationItems.splice(k, 1)[0];
  }

  releaseComponentTypes(): void {
    for (const type of this.types) dissimilateComponentType(type);
  }

  createEntity(initialComponents: (ComponentType<any> | Record<string, unknown>)[]): Entity {
    const id = this.entityIdPool.take() as EntityId;
    this.entityOrdinals[id] = this.nextEntityOrdinal++;
    this.setShape(id, this.Alive);
    const entity = this.pool.borrowTemporarily(id);
    this.createComponents(id, initialComponents);
    STATS: this.dispatcher.stats.numEntities += 1;
    return entity;
  }

  // Everything is copied over from Entity and inlined here to keep performance from cratering.
  // Just calling checkMask with 'create' kills it...
  private createComponents(
    id: EntityId, initialComponents: (ComponentType<any> | Record<string, unknown>)[]
  ): void {
    for (let i = 0; i < initialComponents.length; i++) {
      const type = initialComponents[i];
      CHECK: {
        if (typeof type !== 'function') {
          throw new CheckError(
            `Bad arguments to createEntity: expected component type, got: ${type}`);
        }
        checkTypeDefined(type);
        const mask = this.executingSystem?.accessMasks.create;
        if (mask) {
          const binding = type.__binding!;
          if (((mask[binding.shapeOffset] ?? 0) & binding.shapeMask) === 0) {
            throw new CheckError(
              `System ${this.executingSystem?.name} didn't mark component ${type.name} ` +
              `as createable`);
          }
        }
        if (type.enum) {
          if (this.getEnumShape(id, type.enum, false)) {
            throw new CheckError(
              `Can't add multiple components from the same enum when creating entity: ` +
              type.name);
          }
        } else if (this.hasShape(id, type, false)) {
          throw new CheckError(`Duplicate ${type.name} component when creating entity`);
        }
      }
      let value: ComponentType<any> | Record<string, unknown> | undefined =
        initialComponents[i + 1];
      if (typeof value === 'function') value = undefined; else i++;
      this.setShape(id, type);
      STATS: this.dispatcher.stats.forComponent(type).numEntities += 1;
      initComponent(type, id, value);
    }
  }

  flush(): void {
    const lastExecutingSystem = this.executingSystem;
    this.includeRecentlyDeleted = false;
    CHECK: this.validateShapes(lastExecutingSystem);
    this.executingSystem = undefined;
    this.pool.returnTemporaryBorrows();
    this.removalLog.commit();
  }

  completeCycle(): void {
    this.processRemovalLog();
    CHECK: this.invalidateDeletedHeldEntities();
  }

  private validateShapes(system: SystemBox | undefined): void {
    this.executingSystem = this.validateSystem;
    for (const entityId of this.reshapedEntityIds) {
      for (const componentType of this.validators) {
        try {
          componentType.validate!(this.pool.borrowTemporarily(entityId));
        } catch (e: any) {
          if (!SYSTEM_ERROR_TYPES.includes(e.constructor)) {
            const systemSuffix = system ? ` after system ${system.name} executed` : '';
            const componentNames = this.types
              .filter(type => type !== this.Alive && this.hasShape(entityId, type, false))
              .map(type => type.name)
              .join(', ') || 'none';
            e.message =
              `An entity failed to satisfy ${componentType.name}.validate${systemSuffix}: ` +
              `${e.message} (components: ${componentNames})`;
          }
          throw e;
        }
      }
    }
    this.reshapedEntityIds.length = 0;
  }

  private processRemovalLog(): void {
    const indexer = this.dispatcher.indexer;
    this.removalLog.commit();
    this.entityIdPool.mark();
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
        const entityId = (entry & ENTITY_ID_MASK) as EntityId;
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
          this.removedShapes.set(entityId, type);
        }
      }
    }
    STATS: this.dispatcher.stats.numEntities -= numDeletedEntities;
    this.removedShapes.clear();
    this.removalLog.createPointer(this.prevRemovalPointer);
  }

  private invalidateDeletedHeldEntities(): void {
    let index = 0;
    let entityId;
    while ((entityId = this.entityIdPool.peekSinceMark(index++)) !== undefined) {
      const entity = this.heldEntities[entityId];
      if (entity) {
        entity.__valid = false;
        delete this.heldEntities[entityId];
      }
    }
  }

  holdEntity(id: EntityId): Entity {
    let entity;
    CHECK: entity = this.heldEntities[id];
    if (!entity) {
      entity = new EntityImpl(this);
      entity.__id = id;
      CHECK: this.heldEntities[id] = entity;
    }
    return entity;
  }

  hasShape(id: EntityId, type: ComponentType<any>, allowRecentlyDeleted: boolean): boolean {
    if (this.shapes.isSet(id, type)) return true;
    if (allowRecentlyDeleted && this.includeRecentlyDeleted &&
        this.staleShapes.isSet(id, type)) return true;
    return false;
  }

  getEnumShape(
    id: EntityId, enumeration: ComponentEnum, allowRecentlyDeleted: boolean
  ): ComponentType<any> | undefined {
    let index = this.shapes.get(id, enumeration);
    if (index === 0 && allowRecentlyDeleted && this.includeRecentlyDeleted) {
      index = this.staleShapes.get(id, enumeration);
    }
    if (index > 0) return enumeration.__types[index - 1];
  }

  setShape(id: EntityId, type: ComponentType<any>): void {
    if (type.enum) {
      const oldType = this.getEnumShape(id, type.enum, false);
      if (oldType) this.clearShape(id, oldType);
    }
    this.shapes.set(id, type);
    this.staleShapes.set(id, type);
    CHECK: this.reshapedEntityIds.push(id);
    if (type !== this.Alive || this.hasNegativeQueries) {
      this.dispatcher.shapeLog.push(id | (type.id! << ENTITY_ID_BITS), type);
    }
  }

  clearShape(id: EntityId, type: ComponentType<any>): void {
    this.clearRefs(id, type, false);
    this.shapes.unset(id, type);
    this.removedShapes.set(id, type);
    CHECK: this.reshapedEntityIds.push(id);
    const logEntry = id | (type.id! << ENTITY_ID_BITS);
    this.removalLog.push(logEntry);
    if (type !== this.Alive || this.hasNegativeQueries) {
      this.dispatcher.shapeLog.push(logEntry, type);
    }
    STATS: this.dispatcher.stats.forComponent(type).numEntities -= 1;
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

  matchShape(
    id: EntityId, positiveMask?: number[], positiveValues?: number[], positiveAnyMasks?: number[][],
    negativeMask?: number[], negativeTypes?: ComponentType<any>[]
  ): boolean {
    if (positiveMask && positiveValues && !this.shapes.match(id, positiveMask, positiveValues)) {
      return false;
    }
    if (positiveAnyMasks) {
      for (const mask of positiveAnyMasks) if (this.shapes.matchNot(id, mask)) return false;
    }
    if (negativeMask && !this.shapes.matchNot(id, negativeMask)) return false;
    if (negativeTypes) {
      for (const type of negativeTypes) if (this.shapes.isSet(id, type)) return false;
    }
    return true;
  }
}
