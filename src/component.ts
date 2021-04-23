import {Type} from './type';
import type {EntityId} from './entity';
import type {Dispatcher} from './dispatcher';


interface SchemaDef<JSType> {
  type: Type<JSType>;
  default: JSType;
}

interface Schema {
  [prop: string]: Type<any> | SchemaDef<any>;
}

export type ComponentStorage = 'sparse' | 'packed' | 'compact';

export interface ComponentOptions {
  storage?: ComponentStorage;
  capacity?: number;
}

export interface Field<JSType> {
  name: string;
  type: Type<JSType>;
  default: JSType;
  buffer?: SharedArrayBuffer;
  localBuffer?: any[];
}

export interface ComponentType<C> {
  new(): C;
  schema?: Schema;
  options?: ComponentOptions;

  /**
   * A unique, sequential id number for this component type, assigned automatically by becsy.  It
   * will stay the same across runs as long as the list of defs used to create the world doesn't
   * change.  Feel free to use this for your own purposes but don't change it.
   */
  id?: number;

  __binding?: Binding<C>;
  __bind?(id: EntityId, writable: boolean): C;
  __delete?(id: EntityId): void;
}

export class Binding<C> {
  readonly readonlyInstance: C;
  readonly writableInstance: C;
  readonly flagOffset: number;
  readonly flagMask: number;
  trackedWrites: boolean;
  entityId = 0;
  index = 0;

  constructor(
    readonly type: ComponentType<C>, readonly fields: Field<any>[], readonly dispatcher: Dispatcher,
    public capacity: number
  ) {
    this.readonlyInstance = new type();  // eslint-disable-line new-cap
    this.writableInstance = new type();  // eslint-disable-line new-cap
    this.flagOffset = type.id! >> 5;
    this.flagMask = 1 << (type.id! & 31);
  }
}


interface Storage {
  acquireIndex(id: EntityId): number;
  releaseIndex(id: EntityId): void;
}


class PackedStorage implements Storage {
  private index: Int8Array | Int16Array | Int32Array;
  // layout: bytesPerElement, nextIndex, capacity, numSpares, ...spareIndices
  private spares: Int8Array | Int16Array | Int32Array;

  constructor(
    private readonly maxEntities: number, private readonly binding: Binding<any>,
    private readonly fields: Field<any>[]
  ) {
    this.growSpares();
    this.growCapacity();
  }

  acquireIndex(id: number): number {
    let index = this.index[id];
    if (index === -1) {
      if (this.spares[3] > 0) {
        index = this.spares[--this.spares[3] + 4];
      } else {
        if (this.spares[1] === this.spares[2]) {
          this.binding.capacity = Math.min(this.maxEntities, this.binding.capacity * 2);
          this.growCapacity();
        }
        index = this.spares[1]++;
      }
      this.index[id] = index;
    }
    return index;
  }

  releaseIndex(id: number): void {
    DEBUG: if (this.index[id] === -1) {
      throw new Error(`Internal error, index for entity ${id} not allocated`);
    }
    if (this.spares[3] === this.spares.length - 4) this.growSpares();
    this.spares[this.spares[3]++ + 4] = this.index[id];
    this.index[id] = -1;
  }

  private growCapacity(): void {
    STATS: this.binding.dispatcher.stats.for(this.binding.type).capacity = this.binding.capacity;
    const ArrayType = this.ArrayType;
    const elementSizeChanged = ArrayType.BYTES_PER_ELEMENT !== this.spares?.[0];
    if (!this.index || elementSizeChanged) {
      const buffer = new SharedArrayBuffer(this.maxEntities * ArrayType.BYTES_PER_ELEMENT);
      const newIndex = new ArrayType(buffer);
      if (this.index) newIndex.set(this.index); else newIndex.fill(-1);
      this.index = newIndex;
    }
    if (this.spares && elementSizeChanged) {
      const buffer = new SharedArrayBuffer(this.spares.length * ArrayType.BYTES_PER_ELEMENT);
      const newSpares = new ArrayType(buffer);
      newSpares.set(this.spares);
      newSpares[0] = ArrayType.BYTES_PER_ELEMENT;
      this.spares = newSpares;
    }
    this.spares[2] = this.binding.capacity;
    for (const field of this.fields) field.type.define(this.binding, field);
  }

  private growSpares(): void {
    const ArrayType = this.ArrayType;
    const maxSpares = this.spares ? Math.min(this.maxEntities, (this.spares.length - 4) * 2) : 8;
    const sparesBuffer = new SharedArrayBuffer((4 + maxSpares) * ArrayType.BYTES_PER_ELEMENT);
    const newSpares = new ArrayType(sparesBuffer);
    if (this.spares) {
      newSpares.set(this.spares);
    } else {
      newSpares[0] = ArrayType.BYTES_PER_ELEMENT;
      newSpares[2] = this.binding.capacity;
    }
    this.spares = newSpares;
  }

  private get ArrayType() {
    const capacity = this.binding.capacity;
    return capacity <= (1 << 7) - 1 ? Int8Array :
      capacity <= (1 << 15) - 1 ? Int16Array : Int32Array;
  }
}


export function initComponent(type: ComponentType<any>, id: EntityId, values: any): void {
  CHECK: {
    if (values !== undefined) {
      for (const key in values) {
        if (!type.schema?.[key]) {
          throw new Error(`Property ${key} not defined for component ${type.name}`);
        }
      }
    }
  }
  const component = type.__bind!(id, true);
  for (const field of type.__binding!.fields) {
    (component as any)[field.name] = values?.[field.name] ?? field.default;
  }
}


function gatherFields(type: ComponentType<any>): Field<any>[] {
  const schema = type.schema;
  const fields: Field<any>[] = [];
  for (const name in schema) {
    const entry = schema[name];
    let field;
    if (entry instanceof Type) {
      field = {name, default: entry.defaultValue, type: entry};
    } else {
      field = Object.assign({name, default: entry.type.defaultValue}, entry);
    }
    fields.push(field);
  }
  return fields;
}


export function assimilateComponentType<C>(
  typeId: number, type: ComponentType<C>, dispatcher: Dispatcher
): void {
  const storage = type.options?.storage ?? dispatcher.defaultComponentStorage;
  const capacity = type.options?.capacity ?? (storage === 'sparse' ? dispatcher.maxEntities : 8);
  CHECK: {
    if (storage === 'sparse' && type.options?.capacity) {
      throw new Error(
        `Component type ${type.name} cannot combine options.capacity with options.storage 'sparse'`
      );
    }
    if (capacity <= 0) {
      throw new Error(
        `Component type ${type.name} capacity option must be great than zero: got ${capacity}`);
    }
    if (capacity > dispatcher.maxEntities) {
      throw new Error(
        `Component type ${type.name} has options.capacity higher than world maxEntities; ` +
        `reduce ${type.options!.capacity} to or below ${dispatcher.maxEntities}`);
    }
    if ((typeof process === 'undefined' || process.env.NODE_ENV !== 'test') && type.__bind) {
      throw new Error(`Component type ${type.name} is already in use in another world`);
    }
  }
  type.id = typeId;
  const binding = new Binding<C>(type, gatherFields(type), dispatcher, capacity);
  type.__binding = binding;
  for (const field of binding.fields) field.type.define(binding, field);

  switch (storage) {
    case 'sparse':
      // Inline the trivial storage manager for performance.
      STATS: dispatcher.stats.for(type).capacity = capacity;  // fixed
      type.__bind = (id: EntityId, writable: boolean): C => {
        binding.entityId = id;
        binding.index = id;
        return writable ? binding.writableInstance : binding.readonlyInstance;
      };
      type.__delete = (id: EntityId): void => {
        // nothing to do
      };
      break;
    case 'packed':
    case 'compact': {
      const storageManager = storage === 'packed' ?
        new PackedStorage(dispatcher.maxEntities, binding, binding.fields) : null;
      if (!storageManager) throw new Error('Not yet implemented');
      type.__bind = (id: EntityId, writable: boolean): C => {
        binding.entityId = id;
        binding.index = storageManager.acquireIndex(id);
        return writable ? binding.writableInstance : binding.readonlyInstance;
      };
      type.__delete = (id: EntityId): void => {
        storageManager.releaseIndex(id);
      };
      break;
    }
    default:
      CHECK: throw new Error(`Invalid storage type "${storage}`);
  }
}

