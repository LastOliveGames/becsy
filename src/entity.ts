import {checkTypeDefined, ComponentType, initComponent} from './component';
import type {Registry} from './registry';
import type {SystemBox} from './system';


export type EntityId = number;
export type ReadWriteMasks = {read?: number[], write?: number[]};

export class Entity {
  __id: EntityId;

  constructor(private readonly __registry: Registry) {}

  add(type: ComponentType<any>, values?: any): this {
    // TODO: prevent add when entity has been deleted
    CHECK: {
      this.__checkMask(type, true);
      if (this.__registry.hasShape(this.__id, type, false)) {
        throw new Error(`Entity already has a ${type.name} component`);
      }
    }
    this.__registry.setShape(this.__id, type);
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
    CHECK: this.__checkHas(type, false);
    CHECK: this.__checkMask(type, true);
    this.__registry.clearShape(this.__id, type);
  }

  removeAll(...types: ComponentType<any>[]): void {
    for (const type of types) this.remove(type);
  }

  has(type: ComponentType<any>): boolean {
    CHECK: this.__checkMask(type, false);
    return this.__registry.hasShape(this.__id, type, true);
  }

  read<C>(type: ComponentType<C>): Readonly<C> {
    CHECK: {
      this.__checkMask(type, false);
      this.__checkHas(type, true);
    }
    return type.__bind!(this.__id, false);
  }

  write<C>(type: ComponentType<C>): C {
    CHECK: {
      this.__checkMask(type, true);
      this.__checkHas(type, true);
    }
    if (type.__binding!.trackedWrites) this.__registry.trackWrite(this.__id, type);
    return type.__bind!(this.__id, true);
  }

  delete(): void {
    for (const type of this.__registry.types) {
      if (this.__registry.hasShape(this.__id, type, false)) {
        CHECK: this.__checkMask(type, true);
        this.__registry.clearShape(this.__id, type);
      }
    }
    this.__registry.queueDeletion(this.__id);
    this.__registry.dispatcher.indexer.clearAllRefs(this.__id, false);
  }

  private __checkMask(type: ComponentType<any>, write: boolean): void {
    checkMask(type, this.__registry.executingSystem, write);
  }

  private __checkHas(type: ComponentType<any>, allowRecentlyDeleted: boolean): void {
    if (!this.__registry.hasShape(this.__id, type, allowRecentlyDeleted)) {
      throw new Error(`Entity doesn't have a ${type.name} component`);
    }
  }
}


export function checkMask(
  type: ComponentType<any>, system: SystemBox | undefined, write: boolean
): void {
  checkTypeDefined(type);
  const mask = write ? system?.rwMasks.write : system?.rwMasks.read;
  const ok = !mask || ((mask[type.__binding!.shapeOffset] ?? 0) & type.__binding!.shapeMask) !== 0;
  if (!ok) {
    throw new Error(
      `System didn't mark component ${type.name} as ${write ? 'writable' : 'readable'}`);
  }
}

export function extendMaskAndSetFlag(mask: number[], type: ComponentType<any>): void {
  CHECK: checkTypeDefined(type);
  const flagOffset = type.__binding!.shapeOffset!;
  if (flagOffset >= mask.length) {
    mask.length = flagOffset + 1;
    mask.fill(0, mask.length, flagOffset);
  }
  mask[flagOffset] |= type.__binding!.shapeMask!;
}
