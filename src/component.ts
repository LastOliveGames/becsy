import {Pool, PooledObject} from './pool';
import type {EntityId} from './types';

export class Type<JSType> {
  constructor(readonly byteSize: number, readonly defaultValue: JSType) {}

  static boolean = new Type<boolean>(0.125, false);
  static uint8 = new Type<number>(1, 0);
  static int8 = new Type<number>(1, 0);
  // TODO: fill in the rest
}

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
  __data: DataView;
  __offset: number;
  __mutable: boolean;

  __checkMutable() {
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
  private readonly componentPool: Pool<C>;

  constructor(readonly id: number, readonly type: ComponentType<C>, maxEntities: number) {
    type.__flagOffset = Math.floor(id / 8);
    type.__flagMask = 1 << (id % 8);
    const fields = this.arrangeFields();
    this.stride = this.defineComponentProperties(fields);
    this.saveDefaultComponent(fields);
    this.buffer = new SharedArrayBuffer(this.stride * maxEntities);
    this.data = new DataView(this.buffer);
    this.bytes = new Uint8Array(this.buffer);
    this.componentPool = new Pool(type);
  }

  get name() {
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
        component.release();
      }
    }
  }

  bind(id: EntityId, mutable: boolean): C {
    const component = this.componentPool.borrow();
    component.__data = this.data;
    component.__offset = id * this.stride;
    component.__mutable = mutable;
    component.acquire();
    return component;
  }

  private defineComponentProperties(fields: Field<any>[]): number {
    let offset = 0, booleanMask = 1;
    for (const field of fields) {
      if (field.type === Type.boolean) {
        this.defineBoolean(field.name, offset, booleanMask);
        booleanMask <<= 1;
        if (booleanMask > 128) {
          offset += 1;
          booleanMask = 1;
        }
      } else {
        if (booleanMask !== 1) offset += 1;
        switch (field.type) {
          case Type.int8:
            this.defineInt8(field.name, offset);
            break;
          case Type.uint8:
            this.defineUint8(field.name, offset);
        }
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
      component.release();
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

  private defineBoolean(name: string, fieldOffset: number, mask: number) {
    Object.defineProperty(this.type.prototype, name, {
      enumerable: true,
      get() {
        return ((this as Component).__data.getUint8(this.__offset + fieldOffset) & mask) != 0;
      },
      set(value) {
        const self = this as Component;
        self.__checkMutable();
        const data = self.__data;
        const dataOffset = self.__offset + fieldOffset;
        let byte = data.getUint8(dataOffset);
        if (value) byte |= mask; else byte &= ~mask;
        data.setUint8(dataOffset, byte);
      }
    });
  }

  private defineInt8(name: string, fieldOffset: number) {
    Object.defineProperty(this.type.prototype, name, {
      enumerable: true,
      get() {return (this as Component).__data.getInt8(this.__offset + fieldOffset);},
      set(value) {
        (this as Component).__checkMutable();
        (this as Component).__data.setInt8(this.__offset + fieldOffset, value);
      }
    });
  }

  private defineUint8(name: string, fieldOffset: number) {
    Object.defineProperty(this.type.prototype, name, {
      enumerable: true,
      get() {return (this as Component).__data.getUint8(this.__offset + fieldOffset);},
      set(value) {
        (this as Component).__checkMutable();
        (this as Component).__data.setUint8(this.__offset + fieldOffset, value);
      }
    });
  }
}
