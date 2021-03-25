import {Controller, ComponentType, Field} from './component';
import {Log, LogPointer, SharedAtomicPool} from './datastructures';
import type {Dispatcher} from './dispatcher';
import {Pool} from './pool';
import {Type} from './type';


export type EntityId = number;
export type ReadWriteMasks = {read: number[], write: number[]};

export const ENTITY_ID_BITS = 22;
export const MAX_NUM_ENTITIES = 2 ** ENTITY_ID_BITS - 1;  // ID 0 is reserved
export const ENTITY_ID_MASK = MAX_NUM_ENTITIES;  // happy coincidence!
export const MAX_NUM_COMPONENTS = 2 ** (32 - ENTITY_ID_BITS);


export class Entity {
  __entities: Entities;
  __id: EntityId;
  __forcedComponentsMask: number[] | undefined;
  joined: {[name: string]: Iterable<Entity>} | undefined;

  __reset(entities: Entities, id: EntityId, forcedComponentsMask: number[] | undefined): void {
    this.__entities = entities;
    this.__id = id;
    this.__forcedComponentsMask = forcedComponentsMask;
    this.joined = undefined;
  }

  add(type: ComponentType<any>, values: any): this {
    // TODO: prevent add when component has been deleted
    this.__checkMask(type, true);
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
    this.__checkMask(type, true);
    if (!this.__entities.hasFlag(this.__id, type)) return false;
    this.__remove(type);
    return true;
  }

  removeAll(...types: ComponentType<any>[]): void {
    for (const type of types) this.remove(type);
  }

  has(type: ComponentType<any>): boolean {
    this.__checkMask(type, false);
    return this.__has(type, false);
  }

  read<C>(type: ComponentType<C>): Readonly<C> {
    this.__checkMask(type, false);
    const component = this.__get(type, false);
    if (component === undefined) throw new Error(`Entity doesn't have a ${type.name} component`);
    return component;
  }

  readIfPresent<C>(type: ComponentType<C>): Readonly<C> | undefined {
    this.__checkMask(type, false);
    return this.__get(type, false);
  }

  write<C>(type: ComponentType<C>): C {
    this.__checkMask(type, true);
    const component = this.__get(type, true);
    if (component === undefined) throw new Error(`Entity doesn't have a ${type.name} component`);
    this.__entities.markMutated(this.__id, type);
    return component;
  }

  delete(): void {
    for (const type of this.__entities.types) {
      if (!this.__entities.hasFlag(this.__id, type)) continue;
      this.__checkMask(type, true);
      this.__remove(type);
    }
    this.__entities.queueDeletion(this.__id);
    this.__wipeInboundRefs();
  }

  private __get<C>(type: ComponentType<C>, allowWrite: boolean): C | undefined {
    if (!this.__has(type, allowWrite)) return;
    return this.__entities.bindComponent(type, this.__id, allowWrite);
  }

  private __has(type: ComponentType<any>, allowWrite: boolean): boolean {
    return this.__entities.hasFlag(
      this.__id, type, allowWrite ? undefined : this.__forcedComponentsMask);
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
    const rwMasks = this.__entities.dispatcher.rwMasks;
    if (rwMasks && !this.__entities.maskHasFlag(write ? rwMasks.write : rwMasks.read, type)) {
      throw new Error(
        `System didn't mark component ${type.name} as ${write ? 'writable' : 'readable'}`);
    }
  }
}


export class Entities {
  private readonly stride: number;
  private readonly shapes: Uint32Array;
  private readonly pool = new Pool(Entity);
  private readonly controllers: Map<ComponentType<any>, Controller<any>> = new Map();
  private readonly entityIdPool: SharedAtomicPool;
  private readonly deletionLog: Log;
  private readonly prevDeletionPointer: LogPointer;
  private readonly oldDeletionPointer: LogPointer;

  constructor(
    maxEntities: number, maxLimboEntities: number,
    readonly types: ComponentType<any>[], readonly dispatcher: Dispatcher
  ) {
    dispatcher.addPool(this.pool);
    let componentId = 0;
    for (const type of types) {
      this.controllers.set(type, new Controller(componentId++, type, this.dispatcher));
    }
    this.stride = Math.ceil(this.controllers.size / 32);
    const size = maxEntities * this.stride * 4;
    this.shapes = new Uint32Array(new SharedArrayBuffer(size));
    this.entityIdPool = new SharedAtomicPool(maxEntities, 'maxEntities');
    this.entityIdPool.fillWithDescendingIntegers(1);
    this.deletionLog = new Log(maxLimboEntities, false, 'maxLimboEntities');
    this.prevDeletionPointer = this.deletionLog.createPointer();
    this.oldDeletionPointer = this.deletionLog.createPointer();
  }

  createEntity(initialComponents: (ComponentType<any> | any)[]): Entity {
    const id = this.entityIdPool.take();
    this.shapes.fill(0, id * this.stride, (id + 1) * this.stride);
    // for (let i = id * this.stride; i < (id + 1) * this.stride; i++) this.shapes[i] = 0;
    const entity = this.bind(id);
    if (initialComponents) entity.addAll(...initialComponents);
    this.dispatcher.stats.numEntities += 1;
    return entity;
  }

  bind(id: EntityId, forcedComponentsMask?: number[]): Entity {
    const entity = this.pool.borrow();
    entity.__reset(this, id, forcedComponentsMask);
    return entity;
  }

  queueDeletion(id: EntityId): void {
    this.deletionLog.push(id);
  }

  processEndOfFrame(): void {
    this.dispatcher.stats.maxLimboEntities = this.deletionLog.countSince(this.oldDeletionPointer);
    this.deletionLog.copySince(
      this.oldDeletionPointer, this.prevDeletionPointer, data => this.entityIdPool.refill(data));
    this.deletionLog.createPointer(this.prevDeletionPointer);
  }

  extendMaskAndSetFlag(mask: number[], type: ComponentType<any>): void {
    const ctrl = this.controllers.get(type)!;
    const flagOffset = ctrl.flagOffset;
    if (flagOffset >= mask.length) {
      mask.length = flagOffset + 1;
      mask.fill(0, mask.length, flagOffset);
    }
    mask[flagOffset] |= ctrl.flagMask;
  }

  maskHasFlag(mask: number[], type: ComponentType<any>): boolean {
    const ctrl = this.controllers.get(type)!;
    return ((mask[ctrl.flagOffset] ?? 0) & ctrl.flagMask) !== 0;
  }

  getFields(type: ComponentType<any>): Field<any>[] {
    return this.controllers.get(type)!.fields;
  }

  hasFlag(id: EntityId, type: ComponentType<any>, extraMask?: number[]): boolean {
    const ctrl = this.controllers.get(type)!;
    if ((this.shapes[id * this.stride + ctrl.flagOffset] & ctrl.flagMask) !== 0) return true;
    if (extraMask && ((extraMask[ctrl.flagOffset] ?? 0) & ctrl.flagMask) !== 0) return true;
    return false;
  }

  setFlag(id: EntityId, type: ComponentType<any>): void {
    const ctrl = this.controllers.get(type)!;
    this.shapes[id * this.stride + ctrl.flagOffset] |= ctrl.flagMask;
    this.dispatcher.shapeLog.push(id);
  }

  clearFlag(id: EntityId, type: ComponentType<any>): void {
    const ctrl = this.controllers.get(type)!;
    this.shapes[id * this.stride + ctrl.flagOffset] &= ~ctrl.flagMask;
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
    const ctrl = this.controllers.get(type)!;
    this.dispatcher.writeLog.push(id | (ctrl.id << ENTITY_ID_BITS));
  }

  initComponent(type: ComponentType<any>, id: EntityId, values: any): void {
    this.controllers.get(type)!.init(id, values);
  }

  bindComponent<C, M extends boolean>(
    type: ComponentType<C>, id: EntityId, allowWrite: M): M extends true ? C : Readonly<C>;

  bindComponent<C>(type: ComponentType<C>, id: EntityId, allowWrite: boolean): C {
    return this.controllers.get(type)!.bind(id, allowWrite);
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
