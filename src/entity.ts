import {Component, Controller, ComponentType} from './component';
import {Pool, PooledObject} from './pool';
import type {System} from './system';
import type {EntityId} from './types';


export class Entity extends PooledObject {
  __entities: Entities;
  __id: EntityId;
  __system: System | undefined;
  __borrowedComponents: Readonly<Component>[] = [];

  __reset(entities: Entities, id: EntityId, system?: System): void {
    this.__entities = entities;
    this.__id = id;
    this.__system = system;
    this.__borrowedComponents.length = 0;
  }

  release(): void {
    for (const component of this.__borrowedComponents) {
      component.release();
    }
    this.__borrowedComponents.length = 0;
    super.release();
  }

  add<C extends Component>(type: ComponentType<C>, values: any): void {
    if (this.has(type)) throw new Error(`Entity already has a ${type.name} component`);
    this.__entities.setFlag(this.__id, type);
    this.__entities.initComponent(type, this.__id, values);
  }

  remove<C extends Component>(type: ComponentType<C>): boolean {
    if (!this.has(type)) return false;
    this.__entities.clearFlag(this.__id, type);
    return true;
  }

  has(type: ComponentType<any>): boolean {
    return this.__entities.hasFlag(this.__id, type);
  }

  get<C extends Component>(type: ComponentType<C>): Readonly<C> {
    const component = this.getIfPresent(type, false);
    if (component === undefined) throw new Error(`Entity doesn't have a ${type.name} component`);
    return component;
  }

  getIfPresent<C extends Component>(type: ComponentType<C>, mutate: boolean): C | undefined {
    if (!this.has(type)) return;
    if (this.__system) {
      const maskByte =
        (mutate ? this.__system.__writeMask : this.__system.__readMask)[type.__flagOffset] ?? 0;
      if ((maskByte & type.__flagMask) === 0) {
        throw new Error(
          `System didn't mark ${type.name} component as ${mutate ? 'writable' : 'readable'}`);
      }
    }
    const component = this.__entities.bindComponent(type, this.__id, mutate);
    this.__borrowedComponents.push(component);
    return component;
  }

  mutate<C extends Component>(type: ComponentType<C>): C {
    this.__entities.markMutated(this.__id, type);
    return this.get(type);
  }

  delete(): void {
    for (const type of this.__entities.types) this.remove(type);
  }
}


export class Entities {
  private readonly stride: number;
  private current: Uint8Array;
  private previous: Uint8Array;
  private readonly mutations: Uint8Array;
  private readonly pool = new Pool(Entity);
  private readonly controllers: Map<ComponentType<any>, Controller<any>> = new Map();

  constructor(readonly maxNum: number, readonly types: ComponentType<any>[]) {
    let componentId = 0;
    for (const type of types) {
      this.controllers.set(type, new Controller(componentId++, type, maxNum));
    }
    this.stride = Math.ceil(this.controllers.size / 8);
    this.current = new Uint8Array(maxNum * this.stride);
    this.previous = new Uint8Array(maxNum * this.stride);
    this.mutations = new Uint8Array(maxNum * this.stride);
  }

  tick(): void {
    const swap = this.current;
    this.current = this.previous;
    this.previous = swap;
    this.mutations.fill(0);
  }

  createEntity(callback: (entity: Entity) => void): void {
    let id: EntityId;
    for (id = 1; id < this.maxNum; id += 1) {
      if (!this.isAllocated(id, this.current) &&
          !this.isAllocated(id, this.previous)) {
        const entity = this.bind(id);
        try {
          callback(entity);
          if (!this.isAllocated(id, this.current)) {
            throw new Error('You must add at least one component to a newly created entity');
          }
        } finally {
          entity.release();
        }
        return;
      }
    }
    throw new Error(`Max number of entities reached: ${this.maxNum - 1}`);
  }

  bind(id: EntityId, system?: System): Entity {
    const entity = this.pool.borrow();
    entity.__reset(this, id, system);
    return entity;
  }

  hasFlag(id: EntityId, type: ComponentType<any>): boolean {
    return (this.current[id * this.stride + type.__flagOffset] & type.__flagMask) !== 0;
  }

  setFlag(id: EntityId, type: ComponentType<any>): void {
    this.current[id * this.stride + type.__flagOffset] |= type.__flagMask;
  }

  clearFlag(id: EntityId, type: ComponentType<any>): void {
    this.current[id * this.stride + type.__flagOffset] &= ~type.__flagMask;
  }

  isAllocated(id: EntityId, entities: Uint8Array): boolean {
    const base = id * this.stride;
    for (let offset = 0; offset < this.stride; offset += 1) {
      if (entities[base + offset] !== 0) return true;
    }
    return false;
  }

  markMutated(id: EntityId, type: ComponentType<any>): void {
    this.mutations[id * this.stride + type.__flagOffset] |= type.__flagMask;
  }

  initComponent(type: ComponentType<any>, id: EntityId, values: any): void {
    this.controllers.get(type)!.init(id, values);
  }

  bindComponent<C extends Component, M extends boolean>(
    type: ComponentType<C>, id: EntityId, mutate: M): M extends true ? C : Readonly<C>;
  bindComponent<C extends Component>(type: ComponentType<C>, id: EntityId, mutate: boolean): C {
    return this.controllers.get(type)!.bind(id, mutate);
  }

  matchCurrent(id: EntityId, positiveMask?: number[], negativeMask?: number[]): boolean {
    return this.match(id, this.current, positiveMask, negativeMask);
  }

  matchPrevious(id: EntityId, positiveMask?: number[], negativeMask?: number[]): boolean {
    return this.match(id, this.previous, positiveMask, negativeMask);
  }

  matchMutated(id: EntityId, positiveMask?: number[], negativeMask?: number[]): boolean {
    return this.match(id, this.mutations, positiveMask, negativeMask);
  }

  private match(
    id: EntityId, entities: Uint8Array, positiveMask?: number[], negativeMask?: number[]
  ): boolean {
    const offset = id * this.stride;
    if (positiveMask) {
      for (let i = offset; i < positiveMask.length; i++) {
        const maskByte = positiveMask[i];
        if ((entities[offset + i] & maskByte) !== maskByte) return false;
      }
    }
    if (negativeMask) {
      for (let i = offset; i < negativeMask.length; i++) {
        const maskByte = negativeMask[i];
        if ((entities[offset + i] & maskByte) !== 0) return false;
      }
    }
    return true;
  }

  *iterate(system: System, predicate: (id: EntityId) => boolean): Iterable<Entity> {
    const maxEntities = this.maxNum;
    for (let id = 1; id < maxEntities; id++) {
      if (predicate(id)) {
        const entity = this.bind(id, system);
        try {
          yield entity;
        } finally {
          entity.release();
        }
      }
    }
  }}
