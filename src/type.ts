import type {Binding, ComponentType, Field} from './component';
import type {Entity, EntityId} from './entity';

const encoder = new TextEncoder();
const decoder = new TextDecoder();


function throwNotWritable(binding: Binding<any>) {
  throw new Error(
    `Component is not writable; ` +
    `use entity.write(${binding.type.name}) to acquire a writable version`);
}

export abstract class Type<JSType> {
  constructor(readonly defaultValue: JSType) {}

  abstract defineElastic(binding: Binding<any>, field: Field<any>): void;
  abstract defineFixed(binding: Binding<any>, field: Field<any>): void;

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
  static object: Type<any>;
  static weakObject: Type<any>;
}

class BooleanType extends Type<boolean> {
  constructor() {super(false);}

  defineElastic<C>(binding: Binding<C>, field: Field<boolean>): void {
    let buffer: SharedArrayBuffer;
    let data: Uint8Array;

    field.updateBuffer = () => {
      const capacityChanged = field.buffer?.byteLength !== binding.capacity;
      if (!capacityChanged && field.buffer === buffer) return;
      buffer = capacityChanged ? new SharedArrayBuffer(binding.capacity) : field.buffer!;
      data = new Uint8Array(buffer);
      if (capacityChanged && field.buffer) data.set(new Uint8Array(field.buffer));
      field.buffer = buffer;
    };
    field.updateBuffer();

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): boolean {
        return Boolean(data[binding.index]);
      },
      set(this: C, value: boolean): void {
        data[binding.index] = value ? 1 : 0;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): boolean {
        return Boolean(data[binding.index]);
      },
      set(this: C, value: boolean): void {
        throwNotWritable(binding);
      }
    });
  }

  defineFixed<C>(binding: Binding<C>, field: Field<boolean>): void {
    const buffer = new SharedArrayBuffer(binding.capacity);
    const data = new Uint8Array(buffer);
    field.buffer = buffer;

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): boolean {
        return Boolean(data[binding.index]);
      },
      set(this: C, value: boolean): void {
        data[binding.index] = value ? 1 : 0;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): boolean {
        return Boolean(data[binding.index]);
      },
      set(this: C, value: boolean): void {
        throwNotWritable(binding);
      }
    });
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

  defineElastic<C>(binding: Binding<C>, field: Field<number>): void {
    let buffer: SharedArrayBuffer;
    let data: TypedNumberArray;

    field.updateBuffer = () => {
      const size = binding.capacity * this.NumberArray.BYTES_PER_ELEMENT;
      const capacityChanged = field.buffer?.byteLength !== size;
      if (!capacityChanged && field.buffer === buffer) return;
      buffer = capacityChanged ? new SharedArrayBuffer(size) : field.buffer!;
      data = new this.NumberArray(buffer);
      if (capacityChanged && field.buffer) data.set(new this.NumberArray(field.buffer));
      field.buffer = buffer;
    };
    field.updateBuffer();

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): number {
        return data[binding.index];
      },
      set(this: C, value: number): void {
        data[binding.index] = value;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): number {
        return data[binding.index];
      },
      set(this: C, value: number): void {
        throwNotWritable(binding);
      }
    });
  }

  defineFixed<C>(binding: Binding<C>, field: Field<number>): void {
    const size = binding.capacity * this.NumberArray.BYTES_PER_ELEMENT;
    const buffer = new SharedArrayBuffer(size);
    const data = new this.NumberArray(buffer);
    field.buffer = buffer;

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): number {
        return data[binding.index];
      },
      set(this: C, value: number): void {
        data[binding.index] = value;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): number {
        return data[binding.index];
      },
      set(this: C, value: number): void {
        throwNotWritable(binding);
      }
    });
  }
}

class StaticStringType extends Type<string> {
  private choicesIndex = new Map<string, number>();
  private TypedArray: typeof Uint8Array | typeof Uint16Array | typeof Uint32Array;

  constructor(private readonly choices: string[]) {
    super(choices[0]);
    if (!choices?.length) throw new Error('No choices specified for Type.staticString');
    if (choices.length < 1 << 8) this.TypedArray = Uint8Array;
    else if (choices.length < 1 << 16) this.TypedArray = Uint16Array;
    else this.TypedArray = Uint32Array;
    for (let i = 0; i < choices.length; i++) this.choicesIndex.set(choices[i], i);
  }

  defineElastic<C>(binding: Binding<C>, field: Field<string>): void {
    let buffer: SharedArrayBuffer;
    let data: Uint8Array | Uint16Array | Uint32Array;
    const choices = this.choices, choicesIndex = this.choicesIndex;

    field.updateBuffer = () => {
      const size = binding.capacity * this.TypedArray.BYTES_PER_ELEMENT;
      const capacityChanged = field.buffer?.byteLength !== size;
      if (!capacityChanged && field.buffer === buffer) return;
      buffer = capacityChanged ? new SharedArrayBuffer(size) : field.buffer!;
      data = new this.TypedArray(buffer);
      if (capacityChanged && field.buffer) data.set(new this.TypedArray(field.buffer));
      field.buffer = buffer;
    };
    field.updateBuffer();

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): string {
        const index = data[binding.index];
        const result = choices[index];
        if (result === undefined) throw new Error(`Invalid static string index: ${index}`);
        return result;
      },
      set(this: C, value: string): void {
        const index = choicesIndex.get(value);
        if (index === undefined) throw new Error(`Static string not in set: "${value}"`);
        data[binding.index] = index;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): string {
        const index = data[binding.index];
        const result = choices[index];
        if (result === undefined) throw new Error(`Invalid static string index: ${index}`);
        return result;
      },
      set(this: C, value: string): void {
        throwNotWritable(binding);
      }
    });
  }

  defineFixed<C>(binding: Binding<C>, field: Field<string>): void {
    const choices = this.choices, choicesIndex = this.choicesIndex;
    const size = binding.capacity * this.TypedArray.BYTES_PER_ELEMENT;
    const buffer = new SharedArrayBuffer(size);
    const data = new this.TypedArray(buffer);
    field.buffer = buffer;

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): string {
        const index = data[binding.index];
        const result = choices[index];
        if (result === undefined) throw new Error(`Invalid static string index: ${index}`);
        return result;
      },
      set(this: C, value: string): void {
        const index = choicesIndex.get(value);
        if (index === undefined) throw new Error(`Static string not in set: "${value}"`);
        data[binding.index] = index;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): string {
        const index = data[binding.index];
        const result = choices[index];
        if (result === undefined) throw new Error(`Invalid static string index: ${index}`);
        return result;
      },
      set(this: C, value: string): void {
        throwNotWritable(binding);
      }
    });
  }
}

class DynamicStringType extends Type<string> {
  private readonly maxUtf8Length: number;
  private readonly lengthsStride: number;
  private readonly bytesStride: number;

  constructor(maxUtf8Length: number) {
    super('');
    this.maxUtf8Length = maxUtf8Length + (maxUtf8Length % 2);
    this.lengthsStride = maxUtf8Length / 2 + 1;
    this.bytesStride = this.maxUtf8Length + 2;  // account for length field
  }

  defineElastic<C>(binding: Binding<C>, field: Field<string>): void {
    let buffer: SharedArrayBuffer;
    let lengths: Uint16Array;
    let bytes: Uint8Array;
    const maxUtf8Length = this.maxUtf8Length;
    const lengthsStride = this.lengthsStride, bytesStride = this.bytesStride;

    field.updateBuffer = () => {
      const size = binding.capacity * (this.maxUtf8Length + Uint16Array.BYTES_PER_ELEMENT);
      const capacityChanged = field.buffer?.byteLength !== size;
      if (!capacityChanged && field.buffer === buffer) return;
      buffer = capacityChanged ? new SharedArrayBuffer(size) : field.buffer!;
      lengths = new Uint16Array(buffer);
      bytes = new Uint8Array(buffer);
      if (capacityChanged && field.buffer) bytes.set(new Uint8Array(field.buffer));
      field.buffer = buffer;
    };
    field.updateBuffer();

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): string {
        const length = lengths[binding.index * lengthsStride];
        return decoder.decode(
          new Uint8Array(bytes.buffer, binding.index * bytesStride + 2, length));
      },
      set(this: C, value: string): void {
        const encodedString = encoder.encode(value);
        if (encodedString.byteLength > maxUtf8Length) {
          throw new Error(`Dynamic string length > ${maxUtf8Length} after encoding: ${value}`);
        }
        lengths[binding.index * lengthsStride] = encodedString.byteLength;
        bytes.set(encodedString, binding.index * bytesStride + 2);
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): string {
        const length = lengths[binding.index * lengthsStride];
        return decoder.decode(
          new Uint8Array(bytes.buffer, binding.index * bytesStride + 2, length));
      },
      set(this: C, value: string): void {
        throwNotWritable(binding);
      }
    });
  }

  defineFixed<C>(binding: Binding<C>, field: Field<string>): void {
    const maxUtf8Length = this.maxUtf8Length;
    const lengthsStride = this.lengthsStride, bytesStride = this.bytesStride;
    const size = binding.capacity * (this.maxUtf8Length + Uint16Array.BYTES_PER_ELEMENT);
    const buffer = new SharedArrayBuffer(size);
    const lengths = new Uint16Array(buffer);
    const bytes = new Uint8Array(buffer);
    field.buffer = buffer;

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): string {
        const length = lengths[binding.index * lengthsStride];
        return decoder.decode(
          new Uint8Array(bytes.buffer, binding.index * bytesStride + 2, length));
      },
      set(this: C, value: string): void {
        const encodedString = encoder.encode(value);
        if (encodedString.byteLength > maxUtf8Length) {
          throw new Error(`Dynamic string length > ${maxUtf8Length} after encoding: ${value}`);
        }
        lengths[binding.index * lengthsStride] = encodedString.byteLength;
        bytes.set(encodedString, binding.index * bytesStride + 2);
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): string {
        const length = lengths[binding.index * lengthsStride];
        return decoder.decode(
          new Uint8Array(bytes.buffer, binding.index * bytesStride + 2, length));
      },
      set(this: C, value: string): void {
        throwNotWritable(binding);
      }
    });
  }
}

class RefType extends Type<Entity | null> {
  constructor() {
    super(null);
  }

  defineElastic<C>(binding: Binding<C>, field: Field<Entity | null>): void {
    let buffer: SharedArrayBuffer;
    let data: Int32Array;

    field.updateBuffer = () => {
      const size = binding.capacity * Int32Array.BYTES_PER_ELEMENT;
      const capacityChanged = field.buffer?.byteLength !== size;
      if (!capacityChanged && field.buffer === buffer) return;
      buffer = capacityChanged ? new SharedArrayBuffer(size) : field.buffer!;
      data = new Int32Array(buffer);
      if (capacityChanged && field.buffer) data.set(new Int32Array(field.buffer));
      field.buffer = buffer;
    };
    field.updateBuffer();

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): Entity | null {
        const id = data[binding.index];
        if (id === -1) return null;
        return binding.dispatcher.registry.pool.borrowTemporarily(id);
      },
      set(this: C, value: Entity | null): void {
        const oldId = data[binding.index];
        const newId = value?.__id ?? -1;
        if (oldId === newId) return;
        // TODO: deindex/reindex ref
        // if (oldId !== 0) indexer.remove(oldId, binding.entityId);
        data[binding.index] = newId;
        // if (newId !== 0) indexer.insert(newId, binding.entityId);
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): Entity | null {
        const id = data[binding.index];
        if (id === -1) return null;
        return binding.dispatcher.registry.pool.borrowTemporarily(id);
      },
      set(this: C, value: Entity | null): void {
        throwNotWritable(binding);
      }
    });
  }

  defineFixed<C>(binding: Binding<C>, field: Field<Entity | null>): void {
    const size = binding.capacity * Int32Array.BYTES_PER_ELEMENT;
    const buffer = new SharedArrayBuffer(size);
    const data = new Int32Array(buffer);
    field.buffer = buffer;

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): Entity | null {
        const id = data[binding.index];
        if (id === -1) return null;
        return binding.dispatcher.registry.pool.borrowTemporarily(id);
      },
      set(this: C, value: Entity | null): void {
        const oldId = data[binding.index];
        const newId = value?.__id ?? -1;
        if (oldId === newId) return;
        // TODO: deindex/reindex ref
        // if (oldId !== 0) indexer.remove(oldId, binding.entityId);
        data[binding.index] = newId;
        // if (newId !== 0) indexer.insert(newId, binding.entityId);
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): Entity | null {
        const id = data[binding.index];
        if (id === -1) return null;
        return binding.dispatcher.registry.pool.borrowTemporarily(id);
      },
      set(this: C, value: Entity | null): void {
        throwNotWritable(binding);
      }
    });
  }
}

class ObjectType extends Type<any> {
  constructor() {super(undefined);}

  defineElastic<C>(binding: Binding<C>, field: Field<any>): void {
    const data: any[] = [];
    field.localBuffer = data;
    field.updateBuffer = () => {/* no-op */};

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): any {
        return data[binding.index];
      },
      set(this: C, value: any): void {
        data[binding.index] = value;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): any {
        return data[binding.index];
      },
      set(this: C, value: any): void {
        throwNotWritable(binding);
      }
    });
  }

  defineFixed<C>(binding: Binding<C>, field: Field<boolean>): void {
    const data: any[] = new Array(binding.capacity);
    field.localBuffer = data;
    field.updateBuffer = () => {/* no-op */};

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): any {
        return data[binding.index];
      },
      set(this: C, value: any): void {
        data[binding.index] = value;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): any {
        return data[binding.index];
      },
      set(this: C, value: any): void {
        throwNotWritable(binding);
      }
    });
  }
}

type FinalizerHeldValue = {
  type: ComponentType<any>, field: Field<any>, weakRef: WeakRef<any>, id: EntityId, index: number
};

class WeakObjectType extends Type<any> {
  private finalizers: FinalizationRegistry | undefined;

  constructor() {super(undefined);}

  defineElastic<C>(binding: Binding<C>, field: Field<any>): void {
    const data: WeakRef<any>[] = [];
    field.localBuffer = data;
    field.updateBuffer = () => {/* no-op */};
    const finalizers = this.initFinalizers(binding);

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): any {
        const value = data[binding.index];
        if (value === null || value === undefined) return value;
        return value.deref();
      },
      set(this: C, value: any): void {
        if (value !== null && value !== undefined) {
          const weakRef = new WeakRef(value);
          finalizers?.register(
            value,
            {type: binding.type, field, weakRef, id: binding.entityId, index: binding.index}
          );
          value = weakRef;
        }
        data[binding.index] = value;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): any {
        const value = data[binding.index];
        if (value === null || value === undefined) return value;
        return value.deref();
      },
      set(this: C, value: any): void {
        throwNotWritable(binding);
      }
    });
  }

  defineFixed<C>(binding: Binding<C>, field: Field<boolean>): void {
    const data: WeakRef<any>[] = new Array(binding.capacity);
    field.localBuffer = data;
    field.updateBuffer = () => {/* no-op */};
    const finalizers = this.initFinalizers(binding);

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): any {
        const value = data[binding.index];
        if (value === null || value === undefined) return value;
        return value.deref();
      },
      set(this: C, value: any): void {
        if (value !== null && value !== undefined) {
          const weakRef = new WeakRef(value);
          finalizers?.register(
            value,
            {type: binding.type, field, weakRef, id: binding.entityId, index: binding.index}
          );
          value = weakRef;
        }
        data[binding.index] = value;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): any {
        const value = data[binding.index];
        if (value === null || value === undefined) return value;
        return value.deref();
      },
      set(this: C, value: any): void {
        throwNotWritable(binding);
      }
    });
  }

  private initFinalizers(binding: Binding<any>) {
    if (!binding.trackedWrites) return;
    if (this.finalizers) return this.finalizers;
    const dispatcher = binding.dispatcher;
    if (!dispatcher.writeLog || typeof FinalizationRegistry === 'undefined') return;
    this.finalizers = new FinalizationRegistry(
      ({type, field, weakRef, id, index}: FinalizerHeldValue) => {
        if (field.localBuffer?.[index] === weakRef) {
          dispatcher.registry.trackWrite(id, type);
        }
      }
    );
    return this.finalizers;
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
Type.object = new ObjectType();
Type.weakObject = new WeakObjectType();
