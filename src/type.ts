import type {TypedArray, TypedArrayConstructor} from './buffers';
import type {Binding, Component, ComponentType, Field} from './component';
import {ENTITY_ID_MASK} from './consts';
import type {Entity, EntityId} from './entity';
import {InternalError} from './errors';

const encoder = new TextEncoder();
const decoder = new TextDecoder();


function throwNotWritable(binding: Binding<any>) {
  throw new Error(
    `Component is not writable; ` +
    `use entity.write(${binding.type.name}) to acquire a writable version`);
}

function checkInvalid(component: Component, binding: Binding<any>) {
  if (component.__invalid) {
    throw new Error(
      `Component instance for ${binding.type.name} is no longer valid, as you already bound it ` +
      `to another entity`
    );
  }
}

export abstract class Type<JSType> {
  constructor(readonly defaultValue: JSType, readonly shared = true) {}

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
  static object: Type<any>;
  static weakObject: Type<any>;
  // TODO: add autoremove/autodelete when nulled out
  static ref: Type<Entity | undefined>;
  static backrefs: (type?: ComponentType<any>, fieldName?: string, trackDeletedBackrefs?: boolean)
    => Type<Entity[]>;
  // TODO: add array type
  // TODO: add struct type
}

class BooleanType extends Type<boolean> {
  constructor() {super(false);}

  defineElastic<C>(binding: Binding<C>, field: Field<boolean>): void {
    const bufferKey = `component.${binding.type.id!}.field.${field.seq}`;
    let data: Uint8Array;

    field.updateBuffer = () => {
      binding.dispatcher.buffers.register(
        bufferKey, binding.capacity, Uint8Array, (newData: Uint8Array) => {data = newData;}
      );
    };
    field.updateBuffer();

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): boolean {
        CHECK: checkInvalid(this, binding);
        return Boolean(data[binding.index]);
      },
      set(this: C, value: boolean): void {
        CHECK: checkInvalid(this, binding);
        data[binding.index] = value ? 1 : 0;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): boolean {
        CHECK: checkInvalid(this, binding);
        return Boolean(data[binding.index]);
      },
      set(this: C, value: boolean): void {
        throwNotWritable(binding);
      }
    });
  }

  defineFixed<C>(binding: Binding<C>, field: Field<boolean>): void {
    const bufferKey = `component.${binding.type.id!}.field.${field.seq}`;
    const data = binding.dispatcher.buffers.register(bufferKey, binding.capacity, Uint8Array);

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): boolean {
        CHECK: checkInvalid(this, binding);
        return Boolean(data[binding.index]);
      },
      set(this: C, value: boolean): void {
        CHECK: checkInvalid(this, binding);
        data[binding.index] = value ? 1 : 0;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): boolean {
        CHECK: checkInvalid(this, binding);
        return Boolean(data[binding.index]);
      },
      set(this: C, value: boolean): void {
        throwNotWritable(binding);
      }
    });
  }
}


class NumberType extends Type<number> {
  constructor(private readonly NumberArray: TypedArrayConstructor) {
    super(0);
  }

  defineElastic<C>(binding: Binding<C>, field: Field<number>): void {
    const bufferKey = `component.${binding.type.id!}.field.${field.seq}`;
    let data: TypedArray;

    field.updateBuffer = () => {
      binding.dispatcher.buffers.register(
        bufferKey, binding.capacity, this.NumberArray, (newData: TypedArray) => {data = newData;}
      );
    };
    field.updateBuffer();

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): number {
        CHECK: checkInvalid(this, binding);
        return data[binding.index];
      },
      set(this: C, value: number): void {
        CHECK: checkInvalid(this, binding);
        data[binding.index] = value;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): number {
        CHECK: checkInvalid(this, binding);
        return data[binding.index];
      },
      set(this: C, value: number): void {
        throwNotWritable(binding);
      }
    });
  }

  defineFixed<C>(binding: Binding<C>, field: Field<number>): void {
    const bufferKey = `component.${binding.type.id!}.field.${field.seq}`;
    const data = binding.dispatcher.buffers.register(bufferKey, binding.capacity, this.NumberArray);

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): number {
        CHECK: checkInvalid(this, binding);
        return data[binding.index];
      },
      set(this: C, value: number): void {
        CHECK: checkInvalid(this, binding);
        data[binding.index] = value;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): number {
        CHECK: checkInvalid(this, binding);
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
    const bufferKey = `component.${binding.type.id!}.field.${field.seq}`;
    let data: Uint8Array | Uint16Array | Uint32Array;
    const choices = this.choices, choicesIndex = this.choicesIndex;

    field.updateBuffer = () => {
      binding.dispatcher.buffers.register(
        bufferKey, binding.capacity, this.TypedArray,
        (newData: Uint8Array | Uint16Array | Uint32Array) => {data = newData;}
      );
    };
    field.updateBuffer();

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): string {
        CHECK: checkInvalid(this, binding);
        const index = data[binding.index];
        const result = choices[index];
        if (result === undefined) throw new Error(`Invalid static string index: ${index}`);
        return result;
      },
      set(this: C, value: string): void {
        CHECK: checkInvalid(this, binding);
        const index = choicesIndex.get(value);
        if (index === undefined) throw new Error(`Static string not in set: "${value}"`);
        data[binding.index] = index;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): string {
        CHECK: checkInvalid(this, binding);
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
    const bufferKey = `component.${binding.type.id!}.field.${field.seq}`;
    const choices = this.choices, choicesIndex = this.choicesIndex;
    const data = binding.dispatcher.buffers.register(bufferKey, binding.capacity, this.TypedArray);

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): string {
        CHECK: checkInvalid(this, binding);
        const index = data[binding.index];
        const result = choices[index];
        if (result === undefined) throw new Error(`Invalid static string index: ${index}`);
        return result;
      },
      set(this: C, value: string): void {
        CHECK: checkInvalid(this, binding);
        const index = choicesIndex.get(value);
        if (index === undefined) throw new Error(`Static string not in set: "${value}"`);
        data[binding.index] = index;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): string {
        CHECK: checkInvalid(this, binding);
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
    this.bytesStride = this.maxUtf8Length + 2;  // account for length field
    this.lengthsStride = this.bytesStride / 2;
  }

  defineElastic<C>(binding: Binding<C>, field: Field<string>): void {
    const bufferKey = `component.${binding.type.id!}.field.${field.seq}`;
    let lengths: Uint16Array;
    let bytes: Uint8Array;
    const maxUtf8Length = this.maxUtf8Length;
    const lengthsStride = this.lengthsStride, bytesStride = this.bytesStride;

    field.updateBuffer = () => {
      const size = binding.capacity * (this.maxUtf8Length + Uint16Array.BYTES_PER_ELEMENT);
      binding.dispatcher.buffers.register(
        bufferKey, size, Uint8Array, (newData: Uint8Array) => {
          bytes = newData;
          lengths = new Uint16Array(bytes.buffer);
        }
      );
    };
    field.updateBuffer();

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): string {
        CHECK: checkInvalid(this, binding);
        const length = lengths[binding.index * lengthsStride];
        return decoder.decode(
          new Uint8Array(bytes.buffer, binding.index * bytesStride + 2, length));
      },
      set(this: C, value: string): void {
        CHECK: checkInvalid(this, binding);
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
        CHECK: checkInvalid(this, binding);
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
    const bufferKey = `component.${binding.type.id!}.field.${field.seq}`;
    const maxUtf8Length = this.maxUtf8Length;
    const lengthsStride = this.lengthsStride, bytesStride = this.bytesStride;
    const size = binding.capacity * (this.maxUtf8Length + Uint16Array.BYTES_PER_ELEMENT);
    const bytes = binding.dispatcher.buffers.register(bufferKey, size, Uint8Array);
    const lengths = new Uint16Array(bytes.buffer);

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): string {
        CHECK: checkInvalid(this, binding);
        const length = lengths[binding.index * lengthsStride];
        return decoder.decode(
          new Uint8Array(bytes.buffer, binding.index * bytesStride + 2, length));
      },
      set(this: C, value: string): void {
        CHECK: checkInvalid(this, binding);
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
        CHECK: checkInvalid(this, binding);
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

const STALE_REF_BIT = 2 ** 31;

class RefType extends Type<Entity | undefined> {
  constructor() {
    super(undefined);
  }

  defineElastic<C>(binding: Binding<C>, field: Field<Entity | undefined>): void {
    const bufferKey = `component.${binding.type.id!}.field.${field.seq}`;
    let data: Int32Array;
    const indexer = binding.dispatcher.indexer;
    const registry = binding.dispatcher.registry;
    const pool = registry.pool;
    indexer.registerSelector();

    field.updateBuffer = () => {
      binding.dispatcher.buffers.register(
        bufferKey, binding.capacity, Int32Array, (newData: Int32Array) => {data = newData;}, -1
      );
    };
    field.updateBuffer();

    field.clearRef = (final: boolean, targetId?: EntityId, internalIndex?: number) => {
      DEBUG: if (internalIndex) throw new InternalError('Ref fields have no internal index');
      if (data[binding.index] === -1) return;
      const stale = (data[binding.index] & STALE_REF_BIT) !== 0;
      if (stale && !final) return;
      DEBUG: if (!stale && final) throw new InternalError('Wrong ref stale state');
      const id = (data[binding.index] & ENTITY_ID_MASK) as EntityId;
      const targetIdGiven = targetId !== undefined;
      if (targetIdGiven && id !== targetId) return;
      if (final) data[binding.index] = -1; else data[binding.index] |= STALE_REF_BIT;
      indexer.trackRefChange(
        binding.entityId, binding.type, field.seq, undefined, id, -1 as EntityId, !final, final);
    };

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): Entity | undefined {
        CHECK: checkInvalid(this, binding);
        const id = data[binding.index];
        if (id === -1 || (id & STALE_REF_BIT) && !registry.includeRecentlyDeleted) return;
        return pool.borrowTemporarily((id & ENTITY_ID_MASK) as EntityId);
      },
      set(this: C, value: Entity | undefined | null): void {
        CHECK: checkInvalid(this, binding);
        CHECK: if (value && !registry.hasShape(value.__id, registry.Alive, false)) {
          throw new Error('Referencing a deleted entity is not allowed');
        }
        let oldId = data[binding.index] as EntityId;
        if (oldId !== -1) oldId = (oldId & ENTITY_ID_MASK) as EntityId;
        const stale = oldId !== -1 && !!(data[binding.index] & STALE_REF_BIT);
        const newId = (value?.__id ?? -1) as EntityId;
        if (oldId === newId && !stale) return;
        data[binding.index] = newId;
        indexer.trackRefChange(
          binding.entityId, binding.type, field.seq, undefined, oldId, newId, !stale, true);
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): Entity | undefined {
        CHECK: checkInvalid(this, binding);
        const id = data[binding.index];
        if (id === -1 || (id & STALE_REF_BIT) && !registry.includeRecentlyDeleted) return;
        return pool.borrowTemporarily((id & ENTITY_ID_MASK) as EntityId);
      },
      set(this: C, value: Entity | undefined | null): void {
        throwNotWritable(binding);
      }
    });
  }

  defineFixed<C>(binding: Binding<C>, field: Field<Entity | undefined>): void {
    const bufferKey = `component.${binding.type.id!}.field.${field.seq}`;
    const data = binding.dispatcher.buffers.register(
      bufferKey, binding.capacity, Int32Array, undefined, -1
    );
    const indexer = binding.dispatcher.indexer;
    const registry = binding.dispatcher.registry;
    const pool = registry.pool;
    indexer.registerSelector();

    field.clearRef = (final: boolean, targetId?: EntityId, internalIndex?: number) => {
      DEBUG: if (internalIndex) throw new InternalError('Ref fields have no internal index');
      if (data[binding.index] === -1) return;
      const stale = (data[binding.index] & STALE_REF_BIT) !== 0;
      if (stale && !final) return;
      DEBUG: if (!stale && final) throw new InternalError('Wrong ref stale state');
      const id = (data[binding.index] & ENTITY_ID_MASK) as EntityId;
      const targetIdGiven = targetId !== undefined;
      if (targetIdGiven && id !== targetId) return;
      if (final) data[binding.index] = -1; else data[binding.index] |= STALE_REF_BIT;
      indexer.trackRefChange(
        binding.entityId, binding.type, field.seq, undefined, id, -1 as EntityId, !final, final);
    };

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): Entity | undefined {
        CHECK: checkInvalid(this, binding);
        const id = data[binding.index];
        if (id === -1 || (id & STALE_REF_BIT) && !registry.includeRecentlyDeleted) return;
        return pool.borrowTemporarily((id & ENTITY_ID_MASK) as EntityId);
      },
      set(this: C, value: Entity | undefined | null): void {
        CHECK: checkInvalid(this, binding);
        CHECK: if (value && !registry.hasShape(value.__id, registry.Alive, false)) {
          throw new Error('Referencing a deleted entity is not allowed');
        }
        let oldId = data[binding.index] as EntityId;
        if (oldId !== -1) oldId = (oldId & ENTITY_ID_MASK) as EntityId;
        const stale = oldId !== -1 && !!(data[binding.index] & STALE_REF_BIT);
        const newId = (value?.__id ?? -1) as EntityId;
        if (oldId === newId && !stale) return;
        data[binding.index] = newId;
        indexer.trackRefChange(
          binding.entityId, binding.type, field.seq, undefined, oldId, newId, !stale, true);
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): Entity | undefined {
        CHECK: checkInvalid(this, binding);
        const id = data[binding.index];
        if (id === -1 || (id & STALE_REF_BIT) && !registry.includeRecentlyDeleted) return;
        return pool.borrowTemporarily((id & ENTITY_ID_MASK) as EntityId);
      },
      set(this: C, value: Entity | undefined | null): void {
        throwNotWritable(binding);
      }
    });
  }
}

export const EMPTY_ARRAY: Entity[] = [];

class BackrefsType extends Type<Entity[]> {
  constructor(
    private readonly type?: ComponentType<any>, private readonly fieldName?: string,
    private readonly trackDeletedBackrefs?: boolean
  ) {
    super(EMPTY_ARRAY);
  }

  // TODO: build benchmarks for backrefs and see if storing pointers to the trackers' entities
  // arrays for direct access performs significantly better than looking them up in the indexer's
  // Map each time.
  defineElastic<C>(binding: Binding<C>, field: Field<Entity[]>): void {
    field.updateBuffer = () => {/* no-op */};

    const refField = this.fieldName ?
      this.type?.__binding!.fields.find(aField => aField.name === this.fieldName) : undefined;
    CHECK: {
      if (this.fieldName && !refField) {
        throw new Error(
          `Backrefs field ${binding.type.name}.${field.name} refers to ` +
          `an unknown field ${this.type!.name}.${this.fieldName}`);
      }
      if (refField && refField.type !== Type.ref) {
        throw new Error(
          `Backrefs field ${binding.type.name}.${field.name} refers to ` +
          `a field ${this.type!.name}.${this.fieldName} that is not a ref`);
      }
      if (this.fieldName && !this.type) {
        throw new Error(
          `Backrefs selector has field but no component in ${binding.type.name}.${field.name}`);
      }
      if (this.type && !this.fieldName && !this.type.__binding!.refFields.length) {
        throw new Error(
          `Backrefs field ${binding.type.name}.${field.name} refers to ` +
          `component ${this.type!.name} that has no ref fields`);
      }
    }
    const trackDeletedBackrefs = this.trackDeletedBackrefs;
    const indexer = binding.dispatcher.indexer;
    indexer.registerSelector();  // make sure global selector always registered first
    const selectorId =
      indexer.registerSelector(binding.type, this.type, refField?.seq, this.trackDeletedBackrefs);

    const propertyDefinition = {
      enumerable: true, configurable: true,
      get(this: C): Entity[] {
        CHECK: checkInvalid(this, binding);
        CHECK: if (!trackDeletedBackrefs && binding.dispatcher.registry.includeRecentlyDeleted) {
          throw new Error(
            `Backrefs field ${binding.type.name}.${field.name} not configured to track recently ` +
            `deleted refs`);
        }
        return indexer.getBackrefs(binding.entityId, selectorId);
      },
      set(this: C, value: Entity[]): void {
        CHECK: checkInvalid(this, binding);
        CHECK: if (value !== EMPTY_ARRAY) {
          throw new Error('Backrefs properties are computed automatically, you cannot set them');
        }
      }
    };

    Object.defineProperty(binding.writableInstance, field.name, propertyDefinition);
    Object.defineProperty(binding.readonlyInstance, field.name, propertyDefinition);
  }

  defineFixed(binding: Binding<any>, field: Field<any>): void {
    this.defineElastic(binding, field);
  }
}

class ObjectType extends Type<any> {
  constructor() {super(undefined, false);}

  defineElastic<C>(binding: Binding<C>, field: Field<any>): void {
    const data: any[] = [];
    field.updateBuffer = () => {/* no-op */};

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): any {
        CHECK: checkInvalid(this, binding);
        return data[binding.index];
      },
      set(this: C, value: any): void {
        CHECK: checkInvalid(this, binding);
        data[binding.index] = value;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): any {
        CHECK: checkInvalid(this, binding);
        return data[binding.index];
      },
      set(this: C, value: any): void {
        throwNotWritable(binding);
      }
    });
  }

  defineFixed<C>(binding: Binding<C>, field: Field<boolean>): void {
    const data: any[] = new Array(binding.capacity);
    field.updateBuffer = () => {/* no-op */};

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): any {
        CHECK: checkInvalid(this, binding);
        return data[binding.index];
      },
      set(this: C, value: any): void {
        CHECK: checkInvalid(this, binding);
        data[binding.index] = value;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): any {
        CHECK: checkInvalid(this, binding);
        return data[binding.index];
      },
      set(this: C, value: any): void {
        throwNotWritable(binding);
      }
    });
  }
}

type FinalizerHeldValue = {
  type: ComponentType<any>, data: WeakRef<any>[], weakRef: WeakRef<any>, id: EntityId, index: number
};

class WeakObjectType extends Type<any> {
  private finalizers: FinalizationRegistry<any> | undefined;

  constructor() {super(undefined, false);}

  defineElastic<C>(binding: Binding<C>, field: Field<any>): void {
    const data: WeakRef<any>[] = [];
    field.updateBuffer = () => {/* no-op */};
    const finalizers = this.initFinalizers(binding);

    Object.defineProperty(binding.writableInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): any {
        CHECK: checkInvalid(this, binding);
        const value = data[binding.index];
        if (value === null || value === undefined) return value;
        return value.deref();
      },
      set(this: C, value: any): void {
        CHECK: checkInvalid(this, binding);
        if (value !== null && value !== undefined) {
          const weakRef = new WeakRef(value);
          finalizers?.register(
            value,
            {type: binding.type, data, weakRef, id: binding.entityId, index: binding.index}
          );
          value = weakRef;
        }
        data[binding.index] = value;
      }
    });

    Object.defineProperty(binding.readonlyInstance, field.name, {
      enumerable: true, configurable: true,
      get(this: C): any {
        CHECK: checkInvalid(this, binding);
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
    this.defineElastic(binding, field);
  }

  private initFinalizers(binding: Binding<any>) {
    if (!binding.trackedWrites) return;
    if (this.finalizers) return this.finalizers;
    const dispatcher = binding.dispatcher;
    if (!dispatcher.writeLog || typeof FinalizationRegistry === 'undefined') return;
    this.finalizers = new FinalizationRegistry(
      ({type, data, weakRef, id, index}: FinalizerHeldValue) => {
        if (data[index] === weakRef) dispatcher.registry.trackWrite(id, type);
      }
    );
    return this.finalizers;
  }
}

// The fields below are replicated in the @field decorator, keep them in sync.
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
Type.backrefs = (
  type?: ComponentType<any>, fieldName?: string, trackDeletedBackrefs = false
) => new BackrefsType(type, fieldName, trackDeletedBackrefs);
Type.object = new ObjectType();
Type.weakObject = new WeakObjectType();
