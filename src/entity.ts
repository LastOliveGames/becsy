import {ComponentType, initComponent} from './component';
import type {Registry} from './registry';
import {Type} from './type';


export type EntityId = number;
export type ReadWriteMasks = {read: number[] | undefined, write: number[] | undefined};

export const ENTITY_ID_BITS = 22;
export const MAX_NUM_ENTITIES = 2 ** ENTITY_ID_BITS - 1;  // ID 0 is reserved
export const ENTITY_ID_MASK = MAX_NUM_ENTITIES;  // happy coincidence!
export const MAX_NUM_COMPONENTS = 2 ** (32 - ENTITY_ID_BITS);

const EMPTY_JOIN = Object.freeze({});


export class Entity {
  __id: EntityId;
  joined: {[name: string]: Iterable<Entity>};

  constructor(private readonly __registry: Registry) {}

  __reset(id: EntityId): void {
    this.__id = id;
    this.joined = EMPTY_JOIN;
  }

  add(type: ComponentType<any>, values?: any): this {
    // TODO: prevent add when entity has been deleted
    CHECK: {
      this.__checkMask(type, true);
      if (this.__registry.hasFlag(this.__id, type)) {
        throw new Error(`Entity already has a ${type.name} component`);
      }
    }
    this.__registry.setFlag(this.__id, type);
    initComponent(type, this.__id, values);
    return this;
  }

  addAll(...args: (ComponentType<any> | any)[]): this {
    for (let i = 0; i < args.length; i++) {
      const type = args[i];
      CHECK: {
        if (typeof type !== 'function') {
          throw new Error(`Bad arguments to bulk add: expected component type, got: ${type}`);
        }
      }
      let value = args[i + 1];
      if (typeof value === 'function') value = undefined; else i++;
      this.add(type, value);
    }
    return this;
  }

  remove(type: ComponentType<any>): void {
    CHECK: {
      if (!this.has(type)) throw new Error(`Entity doesn't have a ${type.name} component`);
    }
    this.__remove(type);
  }

  removeAll(...types: ComponentType<any>[]): void {
    for (const type of types) this.remove(type);
  }

  has(type: ComponentType<any>, allowRemoved = false): boolean {
    CHECK: this.__checkMask(type, false);
    return this.__registry.hasFlag(this.__id, type, allowRemoved);
  }

  read<C>(type: ComponentType<C>): Readonly<C> {
    CHECK: {
      if (!this.has(type)) throw new Error(`Entity doesn't have a ${type.name} component`);
    }
    return type.__bind!(this.__id, false);
  }

  readRecentlyRemoved<C>(type: ComponentType<C>): Readonly<C> {
    CHECK: {
      if (!this.has(type, true)) throw new Error(`Entity doesn't have a ${type.name} component`);
    }
    return type.__bind!(this.__id, false);
  }

  write<C>(type: ComponentType<C>): C {
    CHECK: {
      if (!this.has(type, true)) throw new Error(`Entity doesn't have a ${type.name} component`);
    }
    if (type.__trackedWrites) this.__registry.trackWrite(this.__id, type);
    return type.__bind!(this.__id, true);
  }

  delete(): void {
    for (const type of this.__registry.types) {
      if (!this.__registry.hasFlag(this.__id, type)) continue;
      CHECK: this.__checkMask(type, true);
      this.__remove(type);
    }
    this.__registry.queueDeletion(this.__id);
    this.__wipeInboundRefs();
  }

  private __remove(type: ComponentType<any>): void {
    this.__deindexOutboundRefs(type);
    this.__registry.clearFlag(this.__id, type);
  }

  private __deindexOutboundRefs(type: ComponentType<any>): void {
    const fields = type.__fields!;
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
    const rwMasks = this.__registry.executingSystem?.__rwMasks;
    const mask = write ? rwMasks?.write : rwMasks?.read;
    if (mask && !this.__registry.maskHasFlag(mask, type)) {
      throw new Error(
        `System didn't mark component ${type.name} as ${write ? 'writable' : 'readable'}`);
    }
  }
}


