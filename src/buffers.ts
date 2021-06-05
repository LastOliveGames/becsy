export type ArrayBufferLike = ArrayBuffer | SharedArrayBuffer;
export type TypedArray =
  Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array |
  Float64Array;
export type TypedArrayConstructor =
  Uint8ArrayConstructor | Int8ArrayConstructor | Uint16ArrayConstructor | Int16ArrayConstructor |
  Uint32ArrayConstructor | Int32ArrayConstructor | Float32ArrayConstructor |
  Float64ArrayConstructor;
type TypedArrayKind = 'u8' | 'u8' | 'u16' | 'i16' | 'u32' | 'i32' | 'f32' | 'f64';

class Item {
  buffer: ArrayBufferLike;
  array: TypedArray;
  update?: (array: TypedArray) => void;
}

interface PatchItem {
  buffer: SharedArrayBuffer;
  arrayKind: TypedArrayKind;
}

type Patch = Map<string, PatchItem>;

const arrayTypeToKind: Map<TypedArrayConstructor, TypedArrayKind> = new Map([
  [Uint8Array, 'u8'], [Int8Array, 'i8'], [Uint16Array, 'u16'], [Int16Array, 'i16'],
  [Uint32Array, 'u32'], [Int32Array, 'i32'], [Float32Array, 'f32'], [Float64Array, 'f64']
] as [TypedArrayConstructor, TypedArrayKind][]);

const arrayKindToType: Map<TypedArrayKind, TypedArrayConstructor> = new Map([
  ['u8', Uint8Array], ['i8', Int8Array], ['u16', Uint16Array], ['i16', Int16Array],
  ['u32', Uint32Array], ['i32', Int32Array], ['f32', Float32Array], ['f64', Float64Array]
] as [TypedArrayKind, TypedArrayConstructor][]);


export class Buffers {
  private readonly items = new Map<string, Item>();
  private changes?: Patch;

  constructor(private readonly threaded: boolean) {}

  register(
    key: string, length: number, ArrayType: typeof Uint8Array,
    update?: (array: Uint8Array) => void, filler?: number
  ): Uint8Array;

  register(
    key: string, length: number, ArrayType: typeof Int8Array,
    update?: (array: Int8Array) => void, filler?: number
  ): Int8Array;

  register(
    key: string, length: number, ArrayType: typeof Uint16Array,
    update?: (array: Uint16Array) => void, filler?: number
  ): Uint16Array;

  register(
    key: string, length: number, ArrayType: typeof Int16Array,
    update?: (array: Int16Array) => void, filler?: number
  ): Int16Array;

  register(
    key: string, length: number, ArrayType: typeof Uint32Array,
    update?: (array: Uint32Array) => void, filler?: number
  ): Uint32Array;

  register(
    key: string, length: number, ArrayType: typeof Int32Array,
    update?: (array: Int32Array) => void, filler?: number
  ): Int32Array;

  register(
    key: string, length: number, ArrayType: typeof Float32Array,
    update?: (array: Float32Array) => void, filler?: number
  ): Float32Array;

  register(
    key: string, length: number, ArrayType: typeof Float64Array,
    update?: (array: Float64Array) => void, filler?: number
  ): Float64Array;

  register(
    key: string, length: number,
    ArrayType: typeof Int8Array | typeof Int16Array | typeof Int32Array,
    update?: (array: Int8Array | Int16Array | Int32Array) => void, filler?: number
  ): Int8Array | Int16Array | Int32Array;

  register(
    key: string, length: number, ArrayType: TypedArrayConstructor,
    update?: (array: any) => void, filler?: number
  ): TypedArray;

  register(
    key: string, length: number, ArrayType: TypedArrayConstructor,
    update?: (array: any) => void, filler?: number
  ): TypedArray {
    const size = length * ArrayType.BYTES_PER_ELEMENT;
    let item = this.items.get(key);
    const needBiggerBuffer = !item || item.buffer.byteLength < size;
    const needNewArray = needBiggerBuffer || item!.array.constructor !== ArrayType;
    if (!item || needBiggerBuffer || needNewArray) {
      const newItem = new Item();
      newItem.buffer = needBiggerBuffer ?
        (this.threaded ? new SharedArrayBuffer(size) : new ArrayBuffer(size)) : item!.buffer;
      newItem.array = new ArrayType(newItem.buffer);
      if (item) {
        newItem.array.set(item.array);
        if (filler !== undefined && newItem.array.length > item.array.length) {
          newItem.array.fill(filler, item.array.length);
        }
      } else if (filler !== undefined) {
        newItem.array.fill(filler);
      }
      item = newItem;
      this.items.set(key, item);
      if (this.threaded) {
        if (!this.changes) this.changes = new Map();
        this.changes.set(key, {
          buffer: item.buffer as SharedArrayBuffer, arrayKind: arrayTypeToKind.get(ArrayType)!
        });
      }
      update?.(item.array);
    }
    item.update = update;
    return item.array;
  }

  makePatch(): Patch | undefined {
    if (!this.changes) return;
    const patch = this.changes;
    this.changes = undefined;
    return patch;
  }

  applyPatch(patch: Patch): void {
    for (const [key, patchItem] of patch.entries()) {
      const item = new Item();
      item.update = this.items.get(key)?.update;
      item.buffer = patchItem.buffer;
      const ArrayType = arrayKindToType.get(patchItem.arrayKind)!;
      item.array = new ArrayType(item.buffer);
      this.items.set(key, item);
      item.update?.(item.array);
    }
  }

}
