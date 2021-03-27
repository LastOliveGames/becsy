import {Controller, ComponentType, Field} from './component';
import {config} from './config';
import {Log, LogPointer, SharedAtomicPool} from './datastructures';
import type {Dispatcher} from './dispatcher';
import type {System} from './system';
import {Type} from './type';


export type EntityId = number;
export type ReadWriteMasks = {read: number[], write: number[]};

export const ENTITY_ID_BITS = 22;
export const MAX_NUM_ENTITIES = 2 ** ENTITY_ID_BITS - 1;  // ID 0 is reserved
export const ENTITY_ID_MASK = MAX_NUM_ENTITIES;  // happy coincidence!
export const MAX_NUM_COMPONENTS = 2 ** (32 - ENTITY_ID_BITS);


export class Entity {
  __id: EntityId;
  joined: {[name: string]: Iterable<Entity>} | undefined;

  constructor(private readonly __entities: Entities) {}

  __reset(id: EntityId): void {
    this.__id = id;
    this.joined = undefined;
  }

  add(type: ComponentType<any>, values: any): this {
    // TODO: prevent add when component has been deleted
    if (config.DEBUG) this.__checkMask(type, true);
    if (this.__entities.hasFlag(this.__id, type)) {
      throw new Error(`Entity already has a ${type.name} component`);
    }
    this.__entities.setFlag(this.__id, type);
    this.__entities.initComponent(type, this.__id, values);
    return this;
  }

  addAll(...args: (ComponentType<any> | any)[]): this {
    for (let i = 0; i < args.length; i++) {
      const type = args[i];
      if (typeof type !== 'function') {
        throw new Error(`Bad arguments to bulk add: expected component type, got: ${type}`);
      }
      let value = args[i + 1];
      if (typeof value === 'function') value = undefined; else i++;
      this.add(type, value);
    }
    return this;
  }

  remove(type: ComponentType<any>): boolean {
    if (config.DEBUG) this.__checkMask(type, true);
    if (!this.__entities.hasFlag(this.__id, type)) return false;
    this.__remove(type);
    return true;
  }

  removeAll(...types: ComponentType<any>[]): void {
    for (const type of types) this.remove(type);
  }

  has(type: ComponentType<any>): boolean {
    if (config.DEBUG) this.__checkMask(type, false);
    return this.__entities.hasFlag(this.__id, type);
  }

  read<C>(type: ComponentType<C>): Readonly<C> {
    if (config.DEBUG) this.__checkMask(type, false);
    const component = this.__get(type, false, false);
    if (config.DEBUG && component === undefined) {
      throw new Error(`Entity doesn't have a ${type.name} component`);
    }
    return component!;
  }

  readIfPresent<C>(type: ComponentType<C>): Readonly<C> | undefined {
    if (config.DEBUG) this.__checkMask(type, false);
    return this.__get(type, false, false);
  }

  readRecentlyRemoved<C>(type: ComponentType<C>): Readonly<C> {
    if (config.DEBUG) this.__checkMask(type, false);
    const component = this.__get(type, false, true);
    if (config.DEBUG && component === undefined) {
      throw new Error(`Entity doesn't have a ${type.name} component`);
    }
    return component!;
  }

  write<C>(type: ComponentType<C>): C {
    if (config.DEBUG) this.__checkMask(type, true);
    const component = this.__get(type, true, false);
    if (component === undefined) throw new Error(`Entity doesn't have a ${type.name} component`);
    this.__entities.markMutated(this.__id, type);
    return component;
  }

  delete(): void {
    for (const type of this.__entities.types) {
      if (!this.__entities.hasFlag(this.__id, type)) continue;
      if (config.DEBUG) this.__checkMask(type, true);
      this.__remove(type);
    }
    this.__entities.queueDeletion(this.__id);
    this.__wipeInboundRefs();
  }

  private __get<C>(
    type: ComponentType<C>, allowWrite: boolean, allowRemoved: boolean
  ): C | undefined {
    if (!this.__entities.hasFlag(this.__id, type, allowRemoved)) return;
    return type.__bind!(this.__id, allowWrite);
  }

  private __remove(type: ComponentType<any>): void {
    this.__deindexOutboundRefs(type);
    this.__entities.clearFlag(this.__id, type);
  }

  private __deindexOutboundRefs(type: ComponentType<any>): void {
    const fields = this.__entities.getFields(type);
    if (fields.some(field => field.type === Type.ref)) {
      const component = this.write(type);
      for (const field of fields) {
        if (field.type === Type.ref) (component as any)[field.name] = null;
      }
    }
  }

  private __wipeInboundRefs(): void {
    // TODO: implement
  }

  private __checkMask(type: ComponentType<any>, write: boolean): void {
    const rwMasks = this.__entities.executingSystem?.__rwMasks;
    if (rwMasks && !this.__entities.maskHasFlag(write ? rwMasks.write : rwMasks.read, type)) {
      throw new Error(
        `System didn't mark component ${type.name} as ${write ? 'writable' : 'readable'}`);
    }
  }
}


export class EntityPool {
  private readonly borrowed: (Entity | undefined)[];  // indexed by id
  private readonly borrowCounts: Int32Array;  // indexed by id
  private readonly spares: Entity[] = [];
  private readonly temporarilyBorrowedIds: number[] = [];

  constructor(private readonly entities: Entities, maxEntities: number) {
    this.borrowed = Array.from({length: maxEntities});
    this.borrowCounts = new Int32Array(maxEntities);
  }

  borrow(id: number): Entity {
    this.borrowCounts[id] += 1;
    let entity = this.borrowed[id];
    if (!entity) {
      entity = this.borrowed[id] = this.spares.pop() ?? new Entity(this.entities);
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
    if (config.DEBUG && !this.borrowCounts[id]) {
      throw new Error('Internal error, returning entity with no borrows');
    }
    if (--this.borrowCounts[id] <= 0) {
      this.spares.push(this.borrowed[id]!);
      this.borrowed[id] = undefined;
    }
  }
}


export class Entities {
  private readonly stride: number;
  private readonly shapes: Uint32Array;
  private readonly controllers: Map<ComponentType<any>, Controller<any>> = new Map();
  private readonly entityIdPool: SharedAtomicPool;
  readonly pool: EntityPool;
  executingSystem: System | undefined;
  private readonly deletionLog: Log;
  private readonly prevDeletionPointer: LogPointer;
  private readonly oldDeletionPointer: LogPointer;

  constructor(
    maxEntities: number, maxLimboEntities: number,
    readonly types: ComponentType<any>[], readonly dispatcher: Dispatcher
  ) {
    let componentId = 0;
    for (const type of types) {
      this.controllers.set(type, new Controller(componentId++, type, this.dispatcher));
    }
    this.stride = Math.ceil(this.controllers.size / 32);
    const size = maxEntities * this.stride * 4;
    this.shapes = new Uint32Array(new SharedArrayBuffer(size));
    this.entityIdPool = new SharedAtomicPool(maxEntities, 'maxEntities');
    this.entityIdPool.fillWithDescendingIntegers(0);
    this.pool = new EntityPool(this, maxEntities);
    this.deletionLog = new Log(maxLimboEntities, false, 'maxLimboEntities');
    this.prevDeletionPointer = this.deletionLog.createPointer();
    this.oldDeletionPointer = this.deletionLog.createPointer();
  }

  createEntity(initialComponents: (ComponentType<any> | any)[]): Entity {
    const id = this.entityIdPool.take();
    this.shapes.fill(0, id * this.stride, (id + 1) * this.stride);
    // for (let i = id * this.stride; i < (id + 1) * this.stride; i++) this.shapes[i] = 0;
    const entity = this.pool.borrowTemporarily(id);
    if (initialComponents) entity.addAll(...initialComponents);
    this.dispatcher.stats.numEntities += 1;
    return entity;
  }

  queueDeletion(id: EntityId): void {
    this.deletionLog.push(id);
  }

  processEndOfFrame(): void {
    const numDeletedEntities = this.deletionLog.countSince(this.oldDeletionPointer);
    this.dispatcher.stats.numEntities -= numDeletedEntities;
    this.dispatcher.stats.maxLimboEntities = numDeletedEntities;
    this.deletionLog.copySince(
      this.oldDeletionPointer, this.prevDeletionPointer, data => this.entityIdPool.refill(data));
    this.deletionLog.createPointer(this.prevDeletionPointer);
  }

  extendMaskAndSetFlag(mask: number[], type: ComponentType<any>): void {
    const flagOffset = type.__flagOffset!;
    if (flagOffset >= mask.length) {
      mask.length = flagOffset + 1;
      mask.fill(0, mask.length, flagOffset);
    }
    mask[flagOffset] |= type.__flagMask!;
  }

  maskHasFlag(mask: number[], type: ComponentType<any>): boolean {
    return ((mask[type.__flagOffset!] ?? 0) & type.__flagMask!) !== 0;
  }

  getFields(type: ComponentType<any>): Field<any>[] {
    return this.controllers.get(type)!.fields;
  }

  hasFlag(id: EntityId, type: ComponentType<any>, allowRemoved = false): boolean {
    const index = id * this.stride + type.__flagOffset!;
    if ((this.shapes[index] & type.__flagMask!) !== 0) return true;
    if (allowRemoved && this.executingSystem?.__removedEntities.get(id) &&
        (this.executingSystem.__rwMasks.read[type.__flagOffset!] & type.__flagMask!) !== 0) {
      return true;
    }
    return false;
  }

  setFlag(id: EntityId, type: ComponentType<any>): void {
    this.shapes[id * this.stride + type.__flagOffset!] |= type.__flagMask!;
    this.dispatcher.shapeLog.push(id);
  }

  clearFlag(id: EntityId, type: ComponentType<any>): void {
    this.shapes[id * this.stride + type.__flagOffset!] &= ~type.__flagMask!;
    this.dispatcher.shapeLog.push(id);
  }

  isAllocated(id: EntityId, entities: Uint32Array = this.shapes): boolean {
    const base = id * this.stride;
    for (let offset = 0; offset < this.stride; offset += 1) {
      if (entities[base + offset] !== 0) return true;
    }
    return false;
  }

  markMutated(id: EntityId, type: ComponentType<any>): void {
    this.dispatcher.writeLog.push(id | (type.__id! << ENTITY_ID_BITS));
  }

  initComponent(type: ComponentType<any>, id: EntityId, values: any): void {
    this.controllers.get(type)!.init(id, values);
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
