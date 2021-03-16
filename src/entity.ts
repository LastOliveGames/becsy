import {Component, Controller, ComponentType, Field} from './component';
import {Pool} from './pool';
import type {System} from './system';
import {Type} from './type';


export type EntityId = number;


export class Entity {
  __entities: Entities;
  __id: EntityId;
  __system: System | undefined;
  __borrowedComponents: Readonly<Component>[] = [];
  joined: {[name: string]: Iterable<Entity>} | undefined;

  __reset(entities: Entities, id: EntityId, system?: System): void {
    this.__entities = entities;
    this.__id = id;
    this.__system = system;
    this.__borrowedComponents.length = 0;
  }

  __release(): void {
    for (const component of this.__borrowedComponents) {
      this.__entities.relinquishComponent(component);
    }
    this.__borrowedComponents.length = 0;
    delete this.joined;
    this.__entities.relinquish(this);
  }

  add(type: ComponentType<any>, values: any): this {
    this.__checkMask(type, true);
    if (this.has(type)) throw new Error(`Entity already has a ${type.name} component`);
    this.__entities.setFlag(this.__id, type);
    this.__entities.initComponent(type, this.__id, values);
    return this;
  }

  remove(type: ComponentType<any>): boolean {
    this.__checkMask(type, true);
    if (!this.__entities.hasFlag(this.__id, type)) return false;
    this.__remove(type);
    return true;
  }

  has(type: ComponentType<any>): boolean {
    this.__checkMask(type, false);
    return this.__entities.hasFlag(this.__id, type);
  }

  read<C extends Component>(type: ComponentType<C>): Readonly<C> {
    const component = this.__get(type, false);
    if (component === undefined) throw new Error(`Entity doesn't have a ${type.name} component`);
    return component;
  }

  readIfPresent<C extends Component>(type: ComponentType<C>): Readonly<C> | undefined {
    return this.__get(type, false);
  }

  write<C extends Component>(type: ComponentType<C>): C {
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
  }

  private __get<C extends Component>(type: ComponentType<C>, allowWrite: boolean): C | undefined {
    this.__checkMask(type, allowWrite);
    if (!this.has(type)) return;
    const component = this.__entities.bindComponent(type, this.__id, allowWrite, this.__system);
    this.__borrowedComponents.push(component);
    return component;
  }

  private __remove(type: ComponentType<any>): boolean {
    this.__deindexOutboundRefs(type);
    this.__entities.clearFlag(this.__id, type);
    if (!this.__entities.isAllocated(this.__id)) this.__wipeInboundRefs();
    return true;
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
    if (this.__system && !this.__entities.maskHasFlag(
      write ? this.__system.__writeMask : this.__system.__readMask, type
    )) {
      throw new Error(
        `System didn't mark component ${type.name} as ${write ? 'writable' : 'readable'}`);
    }
  }
}


export class Entities {
  private readonly stride: number;
  private nextId = 1;
  private readonly currentBuffer: SharedArrayBuffer;
  private readonly previousBuffer: SharedArrayBuffer;
  private readonly mutationsBuffer: SharedArrayBuffer;
  private readonly current: Uint32Array;
  private readonly previous: Uint32Array;
  private readonly mutations: Uint32Array;
  private readonly pool = new Pool(Entity);
  private readonly controllers: Map<ComponentType<any>, Controller<any>> = new Map();

  constructor(readonly maxNum: number, readonly types: ComponentType<any>[]) {
    let componentId = 0;
    for (const type of types) {
      this.controllers.set(type, new Controller(componentId++, type, this));
    }
    this.stride = Math.ceil(this.controllers.size / 32);
    const size = maxNum * this.stride * 4;
    this.current = new Uint32Array(this.currentBuffer = new SharedArrayBuffer(size));
    this.previous = new Uint32Array(this.previousBuffer = new SharedArrayBuffer(size));
    this.mutations = new Uint32Array(this.mutationsBuffer = new SharedArrayBuffer(size));
  }

  get numComponents(): number {return this.controllers.size;}

  cycle(): void {
    this.previous.set(this.current);
    this.mutations.fill(0);
  }

  createEntity(initialComponents?: (ComponentType<any> | any)[], system?: System): Entity {
    const initial = this.nextId;
    let id = initial;
    while (true) {
      if (!this.isAllocated(id, this.current) && !this.isAllocated(id, this.previous)) {
        this.nextId = id + 1;
        if (this.nextId === this.maxNum) this.nextId = 1;
        const entity = this.bind(id, system);
        if (initialComponents) {
          for (let i = 0; i < initialComponents.length; i++) {
            const type = initialComponents[i];
            if (typeof type !== 'function') {
              throw new Error(
                `Bad arguments to createEntity: expected component type, got: ${type}`);
            }
            let value = initialComponents[i + 1];
            if (typeof value === 'function') value = undefined; else i++;
            entity.add(type, value);
          }
        }
        return entity;
      }
      id += 1;
      if (id === this.maxNum) id = 1;
      if (id === initial) break;
    }
    throw new Error(`Max number of entities reached: ${this.maxNum - 1}`);
  }

  bind(id: EntityId, system?: System): Entity {
    const entity = this.pool.borrow();
    entity.__reset(this, id, system);
    return entity;
  }

  relinquish(entity: Entity): void {
    this.pool.relinquish(entity);
  }

  relinquishComponent(component: Component): void {
    this.controllers.get(component.constructor as ComponentType<any>)!.relinquish(component);
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

  hasFlag(id: EntityId, type: ComponentType<any>): boolean {
    const ctrl = this.controllers.get(type)!;
    return (this.current[id * this.stride + ctrl.flagOffset] & ctrl.flagMask) !== 0;
  }

  setFlag(id: EntityId, type: ComponentType<any>): void {
    const ctrl = this.controllers.get(type)!;
    this.current[id * this.stride + ctrl.flagOffset] |= ctrl.flagMask;
  }

  clearFlag(id: EntityId, type: ComponentType<any>): void {
    const ctrl = this.controllers.get(type)!;
    this.current[id * this.stride + ctrl.flagOffset] &= ~ctrl.flagMask;
  }

  isAllocated(id: EntityId, entities: Uint32Array = this.current): boolean {
    const base = id * this.stride;
    for (let offset = 0; offset < this.stride; offset += 1) {
      if (entities[base + offset] !== 0) return true;
    }
    return false;
  }

  markMutated(id: EntityId, type: ComponentType<any>): void {
    const ctrl = this.controllers.get(type)!;
    this.mutations[id * this.stride + ctrl.flagOffset] |= ctrl.flagMask;
  }

  initComponent(type: ComponentType<any>, id: EntityId, values: any): void {
    this.controllers.get(type)!.init(id, values);
  }

  bindComponent<C extends Component, M extends boolean>(
    type: ComponentType<C>, id: EntityId, allowWrite: M, system?: System
  ): M extends true ? C : Readonly<C>;

  bindComponent<C extends Component>(
    type: ComponentType<C>, id: EntityId, allowWrite: boolean, system?: System
  ): C {
    return this.controllers.get(type)!.bind(id, allowWrite, system);
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
    id: EntityId, entities: Uint32Array, positiveMask?: number[], negativeMask?: number[]
  ): boolean {
    const offset = id * this.stride;
    if (positiveMask) {
      for (let i = 0; i < positiveMask.length; i++) {
        const maskByte = positiveMask[i];
        if ((entities[offset + i] & maskByte) !== maskByte) return false;
      }
    }
    if (negativeMask) {
      for (let i = 0; i < negativeMask.length; i++) {
        const maskByte = negativeMask[i];
        if ((entities[offset + i] & maskByte) !== 0) return false;
      }
    }
    return true;
  }

  *iterate(
    system: System, predicate: (id: EntityId) => boolean, cleanup: () => void
  ): Iterable<Entity> {
    const maxEntities = this.maxNum;
    for (let id = 1; id < maxEntities; id++) {
      if (predicate(id)) {
        const entity = this.bind(id, system);
        yield entity;
        entity.__release();
        system.__releaseEntities();
      }
    }
    cleanup();

    // An explicit iterator implementation doesn't appear to be any faster:
    // return {
    //   [Symbol.iterator]: () => {
    //     let id: EntityId = 1;
    //     let entity: Entity;
    //     return {
    //       next: () => {
    //         if (entity) entity.__release();
    //         system.__releaseEntities();
    //         while (id < maxEntities && !predicate(id)) id++;
    //         if (id < maxEntities) {
    //           entity = this.bind(id, system);
    //           id++;
    //           return {value: entity};
    //         }
    //         cleanup();
    //         return {done: true, value: undefined};
    //       }
    //     };
    //   }
    // };

  }
}
