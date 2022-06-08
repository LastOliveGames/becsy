import type {Component, ComponentOptions, ComponentType} from './component';
import {ComponentEnum} from './enums';
import type {ScheduleBuilder, SystemGroup} from './schedule';
import type {SystemType} from './system';
import {Type} from './type';

interface PropOptions<JSType> {
  type: Type<JSType> | (() => Type<any>);
  default?: JSType;
}

function addFieldSchema(options: PropOptions<unknown>, target: any, name: string): void {
  if (!target.constructor.schema) target.constructor.schema = {};
  target.constructor.schema[name] = options;
}


export function field(
  practicalOptions: PropOptions<unknown> | Type<any> | (() => Type<any>)
) {
  return function(target: any, name: string): void {
    const options: PropOptions<unknown> =
      'type' in practicalOptions ? practicalOptions : {type: practicalOptions};
    addFieldSchema(options, target, name);
  };
}

type VectorDecorator = {
  (target: any, name: string): void;
  vector: (
    elements: number | string[], Class?: new() => any) => (target: any, name: string
  ) => void;
};

function makeVectorDecorator(type: Type<number>) {
  const fn: VectorDecorator = addFieldSchema.bind(null, {type}) as VectorDecorator;
  fn.vector =
    (elements: number | string[], Class?: new() => any) => (target: any, name: string) => {
      addFieldSchema({type: Type.vector(type, elements, Class)}, target, name);
    };
  return fn;
}

// eslint-disable-next-line @typescript-eslint/ban-types
type NotFunction<T> = T extends Function ? never : T;
function backrefs(type?: ComponentType<any>, fieldName?: string, trackDeletedBackrefs?: boolean):
  (target: any, name: string) => void;
function backrefs<T>(target: NotFunction<T>, name: string): void;
function backrefs(
  ...args: any[]
): ((target: any, name: string) => void) | void {
  if (typeof args[0] === 'function' || args[0] === undefined) {
    return addFieldSchema.bind(null, {type: Type.backrefs(...args)});
  }
  addFieldSchema({type: Type.backrefs}, args[0], args[1]!);
}

field.boolean = addFieldSchema.bind(null, {type: Type.boolean});
field.uint8 = makeVectorDecorator(Type.uint8);
field.int8 = makeVectorDecorator(Type.int8);
field.uint16 = makeVectorDecorator(Type.uint16);
field.int16 = makeVectorDecorator(Type.int16);
field.uint32 = makeVectorDecorator(Type.uint32);
field.int32 = makeVectorDecorator(Type.int32);
field.float32 = makeVectorDecorator(Type.float32);
field.float64 = makeVectorDecorator(Type.float64);
field.staticString = function(choices: string[]) {
  return addFieldSchema.bind(null, {type: Type.staticString(choices)});
};
field.dynamicString = function(maxUtf8Length: number) {
  return addFieldSchema.bind(null, {type: Type.dynamicString(maxUtf8Length)});
};
field.ref = addFieldSchema.bind(null, {type: Type.ref});
field.backrefs = backrefs;
field.object = addFieldSchema.bind(null, {type: Type.object});
field.weakObject = addFieldSchema.bind(null, {type: Type.weakObject});


export const componentTypes: (ComponentType<any> | ComponentEnum)[] = [];

/**
 * Declares this class as a component type that will be automatically added to any new world.
 * @param componentClass The component class.
 */
export function component(componentClass: ComponentType<any>): void;

/**
 * Declares this class as a component type that will be automatically added to any new world.
 * @param options The options to apply to the component type.
 */
export function component(options: ComponentOptions): (constructor: ComponentType<any>) => void;

/**
 * Declares this class as a component type that will be automatically added to any new world.
 * @param enumeration An enum of component types to join.
 * @param options Other options to apply to the component type.
 */
export function component(enumeration: ComponentEnum, options?: ComponentOptions):
  (constructor: ComponentType<any>) => void;

export function component(
  arg: ComponentType<Component> | ComponentOptions | ComponentEnum, options?: ComponentOptions
): ((componentClass: ComponentType<any>) => void) | void {
  if (typeof arg === 'function') {
    componentTypes.push(arg);
  } else if (arg instanceof ComponentEnum) {
    return (componentClass: ComponentType<any>) => {
      if (!arg.__types.includes(componentClass)) arg.__types.push(componentClass);
      componentTypes.push(arg);  // duplicates will be removed by Dispatcher
      if (options) componentClass.options = options;
    };
  } else {
    return (componentClass: ComponentType<any>) => {
      componentClass.options = arg;
      componentTypes.push(componentClass);
    };
  }
}


export const systemTypes: (SystemType<any> | SystemGroup)[] = [];

type ScheduleFn = (s: ScheduleBuilder) => ScheduleBuilder;

/**
 * Declare this class as a system type that will be automatically added to any new world.  The class
 * must inherit from System.
 * @param systemClass The system class.
 */
export function system(systemClass: SystemType<any>): void;

/**
 * Declare this class as a system type that will be automatically added to any new world.  The class
 * must inherit from System.
 * @param systemGroup A system group to add the system type to. This system group will also be
 * automatically added to any new world.
 */
export function system(systemGroup: SystemGroup): (constructor: SystemType<any>) => void;

export function system(scheduler: ScheduleFn): (constructor: SystemType<any>) => void;

export function system(systemGroup: SystemGroup, scheduler: ScheduleFn):
  (constructor: SystemType<any>) => void;

export function system(
  arg: SystemType<any> | SystemGroup | ScheduleFn | undefined, scheduler?: ScheduleFn
): ((systemClass: SystemType<any>) => void) | void {
  if (typeof arg === 'function' && !(arg as SystemType<any>).__system) {
    scheduler = arg as ScheduleFn;
    arg = undefined;
  }
  if (typeof arg === 'function') {
    systemTypes.push(arg as SystemType<any>);
  } else {
    if (arg && !systemTypes.includes(arg)) systemTypes.push(arg);
    return (systemClass: SystemType<any>) => {
      if (arg) (arg as SystemGroup).__contents.push(systemClass);
      if (scheduler) systemClass.__staticScheduler = scheduler;
      systemTypes.push(systemClass);
    };
  }
}
