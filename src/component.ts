import {Pool, PooledObject} from './pool';
import {Type} from './type';
import type {Entities, EntityId} from './entity';
import type {System} from './system';

interface SchemaDef<JSType> {
  type: Type<JSType>;
  default?: JSType;
}

interface Schema {
  [prop: string]: Type<any> | SchemaDef<any>;
}

interface Field<JSType> {
  name: string;
  type: Type<JSType>;
  default: JSType;
}

export interface ComponentType<C extends Component> {
  new(): C;
  schema: Schema;
  __flagOffset: number;
  __flagMask: number;
}

export class Component extends PooledObject {
  static __flagOffset: number;
  static __flagMask: number;

  __data: DataView;
  __bytes: Uint8Array;
  __system?: System;
  __offset: number;
  __mutable: boolean;

  __checkMutable(): void {
    if (!this.__mutable) {
      throw new Error(
        'Component is not mutable; use entity.mutate(Component) to acquire a mutable version');
    }
  }
}


export class Controller<C extends Component> {
  private readonly buffer: SharedArrayBuffer;
  private readonly data: DataView;
  private readonly bytes: Uint8Array;
  private readonly stride: number;
  private readonly pool: Pool<C>;

  constructor(readonly id: number, readonly type: ComponentType<C>, readonly entities: Entities) {
    type.__flagOffset = Math.floor(id / 32);
    type.__flagMask = 1 << (id % 32);
    this.pool = new Pool(type);
    const fields = this.arrangeFields();
    this.stride = this.defineComponentProperties(fields);
    this.buffer = new SharedArrayBuffer(this.stride * entities.maxNum);
    this.data = new DataView(this.buffer);
    this.bytes = new Uint8Array(this.buffer);
    this.saveDefaultComponent(fields);
  }

  get name(): string {
    return this.type.name;
  }

  init(id: EntityId, values?: any): void {
    this.bytes.copyWithin(id * this.stride, 0, this.stride);
    if (values !== undefined) {
      const component = this.bind(id, true);
      try {
        for (const key in values) {
          if (!this.type.schema[key]) {
            throw new Error(`Property ${key} not defined for ${this.name} components`);
          }
          (component as any)[key] = values[key];
        }
      } finally {
        component.__release();
      }
    }
  }

  bind(id: EntityId, mutable: boolean, system?: System): C {
    const component = this.pool.borrow();
    component.__data = this.data;
    component.__bytes = this.bytes;
    component.__system = system;
    component.__offset = id * this.stride;
    component.__mutable = mutable;
    component.__acquire();
    return component;
  }

  private defineComponentProperties(fields: Field<any>[]): number {
    let offset = 0, booleanMask = 1;
    for (const field of fields) {
      if (field.type === Type.boolean) {
        field.type.decorate(this.type, field.name, offset, booleanMask);
        booleanMask <<= 1;
        if (booleanMask > 128) {
          offset += 1;
          booleanMask = 1;
        }
      } else {
        if (booleanMask !== 1) {
          offset += 1;
          booleanMask = 1;
        }
        field.type.decorate(this.type, field.name, offset);
        offset += field.type.byteSize;
      }
    }
    if (booleanMask !== 1) offset += 1;
    return offset;
  }

  private saveDefaultComponent(fields: Field<any>[]): void {
    const component = this.bind(0, true);
    try {
      for (const field of fields) {
        (component as any)[field.name] = field.default;
      }
    } finally {
      component.__release();
    }
  }

  private arrangeFields(): Field<any>[] {
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
    fields.sort((a, b) => {
      if (a.type === Type.boolean && b.type !== Type.boolean) return -1;
      if (b.type === Type.boolean && a.type !== Type.boolean) return 1;
      return a < b ? -1 : 1;  // they can't be equal
    });
    return fields;
  }
}
