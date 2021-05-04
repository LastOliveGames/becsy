import {ComponentType, initComponent} from './component';
import type {Registry} from './registry';


export type EntityId = number;
export type ReadWriteMasks = {read: number[], write: number[]};

export class Entity {
  __id: EntityId;

  constructor(private readonly __registry: Registry) {}

  __reset(id: EntityId): void {
    this.__id = id;
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
    STATS: this.__registry.dispatcher.stats.for(type).numEntities += 1;
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
    if (type.__binding!.trackedWrites) this.__registry.trackWrite(this.__id, type);
    return type.__bind!(this.__id, true);
  }

  delete(): void {
    // TODO: add option of wiping inbound refs immediately or put on queue
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
    if (type.__delete) this.__registry.queueRemoval(this.__id, type);
    this.__registry.clearFlag(this.__id, type);
    STATS: this.__registry.dispatcher.stats.for(type).numEntities -= 1;
  }

  private __deindexOutboundRefs(type: ComponentType<any>): void {
    if (type.__binding!.refFields.length) {
      const component = this.write(type);
      for (const field of type.__binding!.refFields) {
        (component as any)[field.name] = null;
      }
    }
  }

  private __wipeInboundRefs(): void {
    // TODO: implement
  }

  private __checkMask(type: ComponentType<any>, write: boolean): void {
    const rwMasks = this.__registry.executingSystem?.rwMasks;
    const mask = write ? rwMasks?.write : rwMasks?.read;
    if (mask && !this.__registry.maskHasFlag(mask, type)) {
      throw new Error(
        `System didn't mark component ${type.name} as ${write ? 'writable' : 'readable'}`);
    }
  }
}


