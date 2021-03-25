import type {Component, ComponentType} from './component';
import type {Entity} from './entity';
import {TextEncoder, TextDecoder} from 'util';
import {config} from './config';
import type {Dispatcher} from './dispatcher';


function checkWritable(component: Component) {
  if (!component.__writable) {
    throw new Error(
      'Component is not writable; use entity.write(Component) to acquire a writable version');
  }
}


export abstract class Type<JSType> {
  constructor(readonly defaultValue: JSType) {}

  abstract define<C extends Component>(
    type: ComponentType<C>, name: string, dispatcher: Dispatcher, maxEntities: number,
    buffer?: SharedArrayBuffer
  ): SharedArrayBuffer;

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
  constructor() {super(false);}

  define<C extends Component>(
    type: ComponentType<C>, name: string, dispatcher: Dispatcher, maxEntities: number,
    buffer?: SharedArrayBuffer
  ): SharedArrayBuffer {
    if (!buffer) buffer = new SharedArrayBuffer(maxEntities);
    const data = new Uint8Array(buffer);
    Object.defineProperty(type.prototype, name, {
      enumerable: true,
      get(this: Component): boolean {
        return Boolean(data[this.__index!]);
      },
      set(this: Component, value: boolean): void {
        if (config.DEBUG) checkWritable(this);
        data[this.__index!] = value ? 1 : 0;
      }
    });
    return buffer;
  }
}

type TypedNumberArray =
  Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array |
  Float32Array | Float64Array;

interface TypeNumberArrayConstructor {
 new (buffer: SharedArrayBuffer): TypedNumberArray;
 BYTES_PER_ELEMENT: number;
}

class NumberType extends Type<number> {
  constructor(private readonly NumberArray: TypeNumberArrayConstructor) {
    super(0);
  }

  define<C extends Component>(
    type: ComponentType<C>, name: string, dispatcher: Dispatcher, maxEntities: number,
    buffer?: SharedArrayBuffer
  ): SharedArrayBuffer {
    if (!buffer) {
      buffer = new SharedArrayBuffer(maxEntities * this.NumberArray.BYTES_PER_ELEMENT);
    }
    const data = new this.NumberArray(buffer);
    Object.defineProperty(type.prototype, name, {
      enumerable: true,
      get(this: Component): number {
        return data[this.__index!];
      },
      set(this: Component, value: number): void {
        if (config.DEBUG) checkWritable(this);
        data[this.__index!] = value;
      }
    });
    return buffer;
  }
}

class StaticStringType extends Type<string> {
  private choicesIndex = new Map<string, number>();
  private TypedArray: typeof Uint8Array | typeof Uint16Array | typeof Uint32Array;

  constructor(private readonly choices: string[]) {
    super(choices[0]);
    if (config.DEBUG && !choices?.length) {
      throw new Error('No choices specified for Type.staticString');
    }
    if (choices.length < 1 << 8) this.TypedArray = Uint8Array;
    else if (choices.length < 1 << 16) this.TypedArray = Uint16Array;
    else this.TypedArray = Uint32Array;
    for (let i = 0; i < choices.length; i++) this.choicesIndex.set(choices[i], i);
  }

  define<C extends Component>(
    type: ComponentType<C>, name: string, dispatcher: Dispatcher, maxEntities: number,
    buffer?: SharedArrayBuffer
  ): SharedArrayBuffer {
    if (!buffer) {
      buffer = new SharedArrayBuffer(maxEntities * this.TypedArray.BYTES_PER_ELEMENT);
    }
    const data = new this.TypedArray(buffer);
    const choices = this.choices, choicesIndex = this.choicesIndex;
    Object.defineProperty(type.prototype, name, {
      enumerable: true,
      get(this: Component): string {
        const index = data[this.__index!];
        const result = choices[index];
        if (config.DEBUG && result === undefined) {
          throw new Error(`Invalid static string index: ${index}`);
        }
        return result;
      },
      set(this: Component, value: string): void {
        if (config.DEBUG) checkWritable(this);
        const index = choicesIndex.get(value);
        if (config.DEBUG && index === undefined) {
          throw new Error(`Static string not in set: "${value}"`);
        }
        data[this.__index!] = index!;
      }
    });
    return buffer;
  }
}

class DynamicStringType extends Type<string> {
  private readonly maxUtf8Length: number;
  private readonly lengthsStride: number;
  private readonly bytesStride: number;
  private static readonly decoder = new TextDecoder();
  private static readonly encoder = new TextEncoder();

  constructor(maxUtf8Length: number) {
    super('');
    this.maxUtf8Length = maxUtf8Length + (maxUtf8Length % 2);
    this.lengthsStride = maxUtf8Length / 2 + 1;
    this.bytesStride = this.maxUtf8Length + 2;  // account for length field
  }

  define<C extends Component>(
    type: ComponentType<C>, name: string, dispatcher: Dispatcher, maxEntities: number,
    buffer?: SharedArrayBuffer
  ): SharedArrayBuffer {
    if (!buffer) buffer = new SharedArrayBuffer(maxEntities * (this.maxUtf8Length + 2));
    const lengths = new Uint16Array(buffer);
    const bytes = new Uint8Array(buffer);
    const maxUtf8Length = this.maxUtf8Length;
    const lengthsStride = this.lengthsStride, bytesStride = this.bytesStride;
    Object.defineProperty(type.prototype, name, {
      enumerable: true,
      get(this: Component): string {
        const length = lengths[this.__index! * lengthsStride];
        return DynamicStringType.decoder.decode(
          new Uint8Array(bytes.buffer, this.__index! * bytesStride + 2, length));
      },
      set(this: Component, value: string): void {
        if (config.DEBUG) checkWritable(this);
        const encodedString = DynamicStringType.encoder.encode(value);
        if (encodedString.byteLength > maxUtf8Length) {
          throw new Error(`Dynamic string length > ${maxUtf8Length} after encoding: ${value}`);
        }
        lengths[this.__index! * lengthsStride] = encodedString.byteLength;
        bytes.set(encodedString, this.__index! * bytesStride + 2);
      }
    });
    return buffer;
  }
}

class RefType extends Type<Entity | null> {
  constructor() {
    super(null);
  }

  define<C extends Component>(
    type: ComponentType<C>, name: string, dispatcher: Dispatcher, maxEntities: number,
    buffer?: SharedArrayBuffer
  ): SharedArrayBuffer {
    if (!buffer) buffer = new SharedArrayBuffer(maxEntities * 4);
    const data = new Int32Array(buffer);
    Object.defineProperty(type.prototype, name, {
      enumerable: true,
      get(this: Component): Entity | null {
        const id = data[this.__index!];
        if (id === -1) return null;
        return dispatcher.bindEntity(id);
      },
      set(this: Component, value: Entity | null): void {
        if (config.DEBUG) checkWritable(this);
        const oldId = data[this.__index!];
        const newId = value?.__id ?? -1;
        if (oldId === newId) return;
        const indexer = dispatcher.indexer;
        if (oldId !== 0) indexer.remove(oldId, this.__entityId!);
        data[this.__index!] = newId;
        if (newId !== 0) indexer.insert(newId, this.__entityId!);
      }
    });
    return buffer;
  }
}

Type.boolean = new BooleanType();
Type.uint8 = new NumberType(Uint8Array);
Type.int8 = new NumberType(Int8Array);
Type.uint16 = new NumberType(Uint16Array);
Type.int16 = new NumberType(Int16Array);
Type.uint32 = new NumberType(Uint32Array);
Type.int32 = new NumberType(Int32Array);
Type.float32 = new NumberType(Float32Array);
Type.float64 = new NumberType(Float64Array);
Type.staticString = (choices: string[]) => new StaticStringType(choices);
Type.dynamicString = (maxUtf8Length: number) => new DynamicStringType(maxUtf8Length);
Type.ref = new RefType();
