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
  __bind?(entityId: number, writable: boolean): C;
  __id?: number;
  __flagOffset?: number;
  __flagMask?: number;
}

export interface Component {
  __entityId?: number;
  __index?: number;
  __writable?: boolean;
}


export class Controller<C extends Component> {
  private readonly maxEntities: number;
  fields: Field<any>[];
  flagOffset: number;
  flagMask: number;

  constructor(
    readonly id: number,
    readonly type: ComponentType<C>,
    readonly dispatcher: Dispatcher
  ) {
    if (config.DEBUG && (type.maxEntities ?? 0) > dispatcher.maxEntities) {
      throw new Error(
        `Component type ${type.name} maxEntities higher than world maxEntities; ` +
        `reduce ${type.maxEntities} to or below ${dispatcher.maxEntities}`);
    }
    this.maxEntities = Math.min(type.maxEntities ?? dispatcher.maxEntities, dispatcher.maxEntities);
    if (this.maxEntities < dispatcher.maxEntities) {
      // TODO: enable packed array mode
    }
    type.__id = id;
    type.__flagOffset = this.flagOffset = id >> 5;
    type.__flagMask = this.flagMask = 1 << (id & 31);
    // eslint-disable-next-line new-cap
    const instance = new type();
    type.__bind = (entityId: number, writable: boolean) => {
      instance.__entityId = entityId;
      instance.__index = entityId;
      instance.__writable = writable;
      return instance;
    };
    this.fields = this.gatherFields();
    this.defineComponentProperties();
  }

  get name(): string {
    return this.type.name;
  }

  init(id: EntityId, values: any): void {
    if (config.DEBUG && values !== undefined) {
      for (const key in values) {
        if (!this.type.schema?.[key]) {
          throw new Error(`Property ${key} not defined for component ${this.name}`);
        }
      }
    }
    // TODO: in packed array mode, allocate a new index
    const component = this.type.__bind!(id, true);
    for (const field of this.fields) {
      (component as any)[field.name] = values?.[field.name] ?? field.default;
    }
  }

  private defineComponentProperties(): void {
    for (const field of this.fields) {
      field.type.define(this.type, field.name, this.dispatcher, this.maxEntities);
    }
  }

  private gatherFields(): Field<any>[] {
    const schema = this.type.schema;
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
}
