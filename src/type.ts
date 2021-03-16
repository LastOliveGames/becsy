import type {Component, ComponentType} from './component';
import type {Entity} from './entity';
import {TextEncoder, TextDecoder} from 'util';

export abstract class Type<JSType> {
  constructor(readonly byteSize: number, readonly defaultValue: JSType) { }
  abstract define(
    target: ComponentType<any>, name: string, fieldOffset: number, mask?: number): void;

  static boolean: Type<boolean>;
  static uint8: Type<number>;
  static int8: Type<number>;
  static uint16: Type<number>;
  static int16: Type<number>;
  static uint32: Type<number>;
  static int32: Type<number>;
  static float32: Type<number>;
  static float64: Type<number>;
  static staticString: (choices: string[]) => Type<string>;
  static dynamicString: (maxUtf8Length: number) => Type<string>;
  static ref: Type<Entity | null>;
}

class BooleanType extends Type<boolean> {
  constructor() {
    super(0.125, false);
  }

  define(target: any, name: string, fieldOffset: number, mask: number): void {
    Object.defineProperty(target, name, {
      enumerable: true,
      get() {
        const component = this as Component;
        const offset = component.__offset + fieldOffset;
        return (component.__data.getUint8(offset) & mask) !== 0;
      },
      set(value) {
        const component = this as Component;
        component.__checkMutable();
        const data = component.__data;
        const dataOffset = component.__offset + fieldOffset;
        let byte = data.getUint8(dataOffset);
        if (value) byte |= mask; else byte &= ~mask;
        data.setUint8(dataOffset, byte);
      }
    });
  }
}

class Uint8Type extends Type<number> {
  constructor() {
    super(1, 0);
  }

  define(target: ComponentType<any>, name: string, fieldOffset: number): void {
    Object.defineProperty(target.prototype, name, {
      enumerable: true,
      get(this: Component) {
        const offset = this.__offset + fieldOffset;
        return this.__data.getUint8(offset);
      },
      set(this: Component, value: number) {
        const offset = this.__offset + fieldOffset;
        this.__checkMutable();
        this.__data.setUint8(offset, value);
      }
    });
  }
}

class Int8Type extends Type<number> {
  constructor() {
    super(1, 0);
  }

  define(target: ComponentType<any>, name: string, fieldOffset: number): void {
    Object.defineProperty(target.prototype, name, {
      enumerable: true,
      get(this: Component) {
        const offset = this.__offset + fieldOffset;
        return this.__data.getInt8(offset);
      },
      set(this: Component, value: number) {
        const offset = this.__offset + fieldOffset;
        this.__checkMutable();
        this.__data.setInt8(offset, value);
      }
    });
  }
}

class Uint16Type extends Type<number> {
  constructor() {
    super(2, 0);
  }

  define(target: ComponentType<any>, name: string, fieldOffset: number): void {
    Object.defineProperty(target.prototype, name, {
      enumerable: true,
      get(this: Component) {
        const offset = this.__offset + fieldOffset;
        return this.__data.getUint16(offset);
      },
      set(this: Component, value: number) {
        const offset = this.__offset + fieldOffset;
        this.__checkMutable();
        this.__data.setUint16(offset, value);
      }
    });
  }
}

class Int16Type extends Type<number> {
  constructor() {
    super(2, 0);
  }

  define(target: ComponentType<any>, name: string, fieldOffset: number): void {
    Object.defineProperty(target.prototype, name, {
      enumerable: true,
      get(this: Component) {
        const offset = this.__offset + fieldOffset;
        return this.__data.getInt16(offset);
      },
      set(this: Component, value: number) {
        const offset = this.__offset + fieldOffset;
        this.__checkMutable();
        this.__data.setInt16(offset, value);
      }
    });
  }
}

class Uint32Type extends Type<number> {
  constructor() {
    super(4, 0);
  }

  define(target: ComponentType<any>, name: string, fieldOffset: number): void {
    Object.defineProperty(target.prototype, name, {
      enumerable: true,
      get(this: Component) {
        const offset = this.__offset + fieldOffset;
        return this.__data.getUint32(offset);
      },
      set(this: Component, value: number) {
        const offset = this.__offset + fieldOffset;
        this.__checkMutable();
        this.__data.setUint32(offset, value);
      }
    });
  }
}

class Int32Type extends Type<number> {
  constructor() {
    super(4, 0);
  }

  define(target: ComponentType<any>, name: string, fieldOffset: number): void {
    Object.defineProperty(target.prototype, name, {
      enumerable: true,
      get(this: Component) {
        const offset = this.__offset + fieldOffset;
        return this.__data.getInt32(offset);
      },
      set(this: Component, value: number) {
        const offset = this.__offset + fieldOffset;
        this.__checkMutable();
        this.__data.setInt32(offset, value);
      }
    });
  }
}

class Float32Type extends Type<number> {
  constructor() {
    super(4, 0);
  }

  define(target: ComponentType<any>, name: string, fieldOffset: number): void {
    Object.defineProperty(target.prototype, name, {
      enumerable: true,
      get(this: Component) {
        const offset = this.__offset + fieldOffset;
        return this.__data.getFloat32(offset);
      },
      set(this: Component, value: number) {
        const offset = this.__offset + fieldOffset;
        this.__checkMutable();
        this.__data.setFloat32(offset, value);
      }
    });
  }
}

class Float64Type extends Type<number> {
  constructor() {
    super(8, 0);
  }

  define(target: ComponentType<any>, name: string, fieldOffset: number): void {
    Object.defineProperty(target.prototype, name, {
      enumerable: true,
      get(this: Component) {
        const offset = this.__offset + fieldOffset;
        return this.__data.getFloat64(offset);
      },
      set(this: Component, value: number) {
        const offset = this.__offset + fieldOffset;
        this.__checkMutable();
        this.__data.setFloat64(offset, value);
      }
    });
  }
}


class StaticStringType extends Type<string> {
  private getter: (this: DataView, offset: number) => number;
  private setter: (this: DataView, offset: number, value: number) => void;
  private choicesIndex = new Map<string, number>();

  constructor(private readonly choices: string[]) {
    super(choices.length < 1 << 8 ? 1 : choices.length < 1 << 16 ? 2 : 4, '');
    const accessor = this.byteSize === 1 ? 'Uint8' : this.byteSize === 2 ? 'Uint16' : 'Uint32';
    this.getter = (DataView.prototype as any)[`get${accessor}`];
    this.setter = (DataView.prototype as any)[`set${accessor}`];
    for (let i = 0; i < choices.length; i++) this.choicesIndex.set(choices[i], i);
  }

  define(target: ComponentType<any>, name: string, fieldOffset: number): void {
    const getter = this.getter, setter = this.setter;
    const choices = this.choices, choicesIndex = this.choicesIndex;
    Object.defineProperty(target.prototype, name, {
      enumerable: true,
      get(this: Component) {
        const offset = this.__offset + fieldOffset;
        const index = getter.call(this.__data, offset);
        const result = choices[index];
        if (result === undefined) throw new Error(`Invalid static string index: ${index}`);
        return result;
      },
      set(this: Component, value: string) {
        const offset = this.__offset + fieldOffset;
        this.__checkMutable();
        const index = choicesIndex.get(value);
        if (index === undefined) throw new Error(`Static string not in set: "${value}"`);
        setter.call(this.__data, offset, index);
      }
    });
  }
}

class DynamicStringType extends Type<string> {
  private static readonly decoder = new TextDecoder();
  private static readonly encoder = new TextEncoder();

  constructor(private readonly maxUtf8Length: number) {
    super(maxUtf8Length + 2, '');
  }

  define(target: ComponentType<any>, name: string, fieldOffset: number): void {
    const maxUtf8Length = this.maxUtf8Length;
    Object.defineProperty(target.prototype, name, {
      enumerable: true,
      get(this: Component) {
        const offset = this.__offset + fieldOffset;
        const length = this.__data.getUint16(offset);
        return DynamicStringType.decoder.decode(
          new Uint8Array(this.__data.buffer, offset + 2, length));
      },
      set(this: Component, value: string) {
        const offset = this.__offset + fieldOffset;
        this.__checkMutable();
        const encodedString = DynamicStringType.encoder.encode(value);
        if (encodedString.byteLength > maxUtf8Length) {
          throw new Error(`Dynamic string length > ${maxUtf8Length} after encoding: ${value}`);
        }
        this.__data.setUint16(offset, encodedString.byteLength);
        this.__bytes.set(encodedString, offset);
      }
    });
  }
}

class RefType extends Type<Entity | null> {
  constructor() {
    super(4, null);
  }

  define(target: ComponentType<any>, name: string, fieldOffset: number): void {
    Object.defineProperty(target.prototype, name, {
      enumerable: true,
      get(this: Component) {
        const offset = this.__offset + fieldOffset;
        if (!this.__system) throw new Error('Unable to dereference entity in this context');
        const id = this.__data.getUint32(offset);
        if (id === 0) return null;
        return this.__system.__bindAndBorrowEntity(id);
      },
      set(this: Component, value: Entity) {
        const offset = this.__offset + fieldOffset;
        this.__checkMutable();
        this.__data.setUint32(offset, value?.__id || 0);
      }
    });

  }
}

Type.boolean = new BooleanType();
Type.uint8 = new Uint8Type();
Type.int8 = new Int8Type();
Type.uint16 = new Uint16Type();
Type.int16 = new Int16Type();
Type.uint32 = new Uint32Type();
Type.int32 = new Int32Type();
Type.float32 = new Float32Type();
Type.float64 = new Float64Type();
Type.staticString = (choices: string[]) => new StaticStringType(choices);
Type.dynamicString = (maxUtf8Length: number) => new DynamicStringType(maxUtf8Length);
Type.ref = new RefType();
