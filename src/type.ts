import type {Component, ComponentType} from './component';
import {TextEncoder, TextDecoder} from 'util';

export abstract class Type<JSType> {
  constructor(readonly byteSize: number, readonly defaultValue: JSType) { }
  abstract decorate(
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
}

class BooleanType extends Type<boolean> {
  constructor() {
    super(0.125, false);
  }

  decorate(target: any, name: string, fieldOffset: number, mask: number): void {
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

class NumericType extends Type<number> {
  private getter: (this: DataView, offset: number) => number;
  private setter: (this: DataView, offset: number, value: number) => void;

  constructor(byteSize: number, accessor: string) {
    super(byteSize, 0);
    this.getter = (DataView.prototype as any)[`get${accessor}`];
    this.setter = (DataView.prototype as any)[`set${accessor}`];
  }

  decorate(target: any, name: string, fieldOffset: number): void {
    const getter = this.getter, setter = this.setter;
    Object.defineProperty(target, name, {
      enumerable: true,
      get() {
        const component = this as Component;
        const offset = component.__offset + fieldOffset;
        return getter.call(component.__data, offset);
      },
      set(value) {
        const component = this as Component;
        const offset = component.__offset + fieldOffset;
        component.__checkMutable();
        setter.call(component.__data, offset, value);
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

  decorate(target: any, name: string, fieldOffset: number): void {
    const getter = this.getter, setter = this.setter;
    const choices = this.choices, choicesIndex = this.choicesIndex;
    Object.defineProperty(target, name, {
      enumerable: true,
      get() {
        const component = this as Component;
        const offset = component.__offset + fieldOffset;
        const index = getter.call(component.__data, offset);
        const result = choices[index];
        if (result === undefined) throw new Error(`Invalid static string index: ${index}`);
        return result;
      },
      set(value) {
        const component = this as Component;
        const offset = component.__offset + fieldOffset;
        component.__checkMutable();
        const index = choicesIndex.get(value);
        if (index === undefined) throw new Error(`Static string not in set: "${value}"`);
        setter.call(component.__data, offset, index);
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

  decorate(target: any, name: string, fieldOffset: number): void {
    Object.defineProperty(target, name, {
      enumerable: true,
      get() {
        const component = this as Component;
        const offset = component.__offset + fieldOffset;
        const length = component.__data.getUint16(offset);
        return DynamicStringType.decoder.decode(
          new Uint8Array(component.__data.buffer, offset + 2, length));
      },
      set(value) {
        const component = this as Component;
        const offset = component.__offset + fieldOffset;
        component.__checkMutable();
        const encodedString = DynamicStringType.encoder.encode(value);
        if (encodedString.byteLength > this.maxUtf8Length) {
          throw new Error(`Dynamic string length > ${this.maxUtf8Length} after encoding: ${value}`);
        }
        component.__data.setUint16(offset, encodedString.byteLength);
        component.__bytes.set(encodedString, offset);
      }
    });
  }
}

Type.boolean = new BooleanType();
Type.uint8 = new NumericType(1, 'Uint8');
Type.int8 = new NumericType(1, 'Int8');
Type.uint16 = new NumericType(2, 'Uint16');
Type.int16 = new NumericType(2, 'Int16');
Type.uint32 = new NumericType(4, 'Uint32');
Type.int32 = new NumericType(4, 'Int32');
Type.float32 = new NumericType(4, 'Float32');
Type.float64 = new NumericType(8, 'Float64');
Type.staticString = (choices: string[]) => new StaticStringType(choices);
Type.dynamicString = (maxUtf8Length: number) => new DynamicStringType(maxUtf8Length);
