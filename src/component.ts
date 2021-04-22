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

interface Options {
  storage?: ComponentStorage;
  capacity?: number;
}

interface StorageMethods<C> {
  bind(id: EntityId, writable: boolean): C;
  delete(id: EntityId): void;
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
  options?: Options;
  __id?: number;
  __flagOffset?: number;
  __flagMask?: number;
  __trackedWrites?: boolean;
  __fields?: Field<any>[];
  __bind?(id: EntityId, writable: boolean): C;
  __delete?(id: EntityId): void;
}

export class Binding<C> {
  readonly readonlyInstance: C;
  readonly writableInstance: C;
  entityId = 0;
  index = 0;

  constructor(
    readonly type: ComponentType<C>, readonly dispatcher: Dispatcher, readonly capacity: number
  ) {
    this.readonlyInstance = new type();  // eslint-disable-line new-cap
    this.writableInstance = new type();  // eslint-disable-line new-cap
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
  for (const field of type.__fields!) {
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

const createStorageMethods = {
  sparse<C>(binding: Binding<C>): StorageMethods<C> {
    return {
      bind: (id: EntityId, writable: boolean) => {
        binding.entityId = id;
        binding.index = id;
        return writable ? binding.writableInstance : binding.readonlyInstance;
      },
      delete: (id: EntityId) => {
        /* do nothing! */
      }
    };
  },

  packed<C>(binding: Binding<C>): StorageMethods<C> {
    throw new Error('Not implemented');
  },

  compact<C>(binding: Binding<C>): StorageMethods<C> {
    throw new Error('Not implemented');
  }
};


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
    if (capacity > dispatcher.maxEntities) {
      throw new Error(
        `Component type ${type.name} has options.capacity higher than world maxEntities; ` +
        `reduce ${type.options!.capacity} to or below ${dispatcher.maxEntities}`);
    }
    if ((typeof process === 'undefined' || process.env.NODE_ENV !== 'test') && type.__bind) {
      throw new Error(`Component type ${type.name} is already in use in another world`);
    }
  }
  type.__id = typeId;
  type.__flagOffset = typeId >> 5;
  type.__flagMask = 1 << (typeId & 31);
  const binding = new Binding<C>(type, dispatcher, capacity);
  ({bind: type.__bind, delete: type.__delete} = createStorageMethods[storage](binding));
  type.__fields = gatherFields(type);
  for (const field of type.__fields!) field.type.define(binding, field);
}

