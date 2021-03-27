import {Type} from './type';
import type {EntityId} from './entity';
import {config} from './config';
import type {Dispatcher} from './dispatcher';


interface SchemaDef<JSType> {
  type: Type<JSType>;
  default: JSType;
}

interface Schema {
  [prop: string]: Type<any> | SchemaDef<any>;
}

export interface Field<JSType> {
  name: string;
  type: Type<JSType>;
  default: JSType;
}

export interface ComponentType<C extends Component> {
  new(): C;
  schema?: Schema;
  maxEntities?: number;
  __id?: number;
  __flagOffset?: number;
  __flagMask?: number;
  __fields?: Field<any>[];
  __bind?(id: EntityId, writable: boolean): C;
}

export interface Component {
  __entityId?: number;
  __index?: number;
  __writable?: boolean;
}


export function initComponent(type: ComponentType<any>, id: EntityId, values: any): void {
  if (config.DEBUG && values !== undefined) {
    for (const key in values) {
      if (!type.schema?.[key]) {
        throw new Error(`Property ${key} not defined for component ${type.name}`);
      }
    }
  }
  // TODO: in packed array mode, allocate a new index
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


export function decorateComponentType(
  typeId: number, type: ComponentType<any>, dispatcher: Dispatcher
): void {
  if (config.DEBUG && (type.maxEntities ?? 0) > dispatcher.maxEntities) {
    throw new Error(
      `Component type ${type.name} maxEntities higher than world maxEntities; ` +
      `reduce ${type.maxEntities} to or below ${dispatcher.maxEntities}`);
  }
  const maxEntities = Math.min(type.maxEntities ?? dispatcher.maxEntities, dispatcher.maxEntities);
  if (maxEntities < dispatcher.maxEntities) {
    // TODO: enable packed array mode
  }
  type.__id = typeId;
  type.__flagOffset = typeId >> 5;
  type.__flagMask = 1 << (typeId & 31);
  const instance = new type();  // eslint-disable-line new-cap
  type.__bind = (id: EntityId, writable: boolean) => {
    instance.__entityId = id;
    instance.__index = id;
    instance.__writable = writable;
    return instance;
  };
  type.__fields = gatherFields(type);
  for (const field of type.__fields!) field.type.define(type, field.name, dispatcher, maxEntities);
}

