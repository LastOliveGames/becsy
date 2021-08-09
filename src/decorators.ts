import type {ComponentOptions, ComponentType} from './component';
import type {SystemGroup} from './schedules';
import type {SystemType} from './system';
import type {Type} from './type';

interface PropOptions<JSType> {
  type: Type<JSType> | (() => Type<any>);
  default?: JSType;
}


export function field<JSType>(
  practicalOptions: PropOptions<JSType> | Type<any> | (() => Type<any>)
) {
  return function(target: any, name: string): void {
    if (!target.constructor.schema) target.constructor.schema = {};
    const options: PropOptions<JSType> =
      'type' in practicalOptions ? practicalOptions : {type: practicalOptions};
    target.constructor.schema[name] = options;
  };
}


export const componentTypes: ComponentType<any>[] = [];

/**
 * Declare this class as a component type that will be automatically added to any new world.
 * @param componentClass The component class.
 */
export function component(componentClass: ComponentType<any>): void;

/**
 * Declare this class as a component type that will be automatically added to any new world.
 * @param options The options to apply to the component type.
 */
export function component(options: ComponentOptions): (constructor: ComponentType<any>) => void;

export function component(arg: ComponentType<any> | ComponentOptions):
    ((componentClass: ComponentType<any>) => void) | void {
  if (typeof arg === 'function') {
    componentTypes.push(arg);
  } else {
    return (componentClass: ComponentType<any>) => {
      componentClass.options = arg;
      componentTypes.push(componentClass);
    };
  }
}


export const systemTypes: (SystemType<any> | SystemGroup)[] = [];

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

export function system(arg: SystemType<any> | SystemGroup):
    ((systemClass: SystemType<any>) => void) | void {
  if (typeof arg === 'function') {
    systemTypes.push(arg);
  } else {
    if (!systemTypes.includes(arg)) systemTypes.push(arg);
    return (systemClass: SystemType<any>) => {
      arg.__contents.push(systemClass);
    };
  }
}
