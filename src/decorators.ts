import type {ComponentOptions, ComponentType} from './component';
import type {Type} from './type';

interface PropOptions<JSType> {
  type: Type<JSType> | (() => Type<any>);
  default?: JSType;
}


export function prop<JSType>(
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

export function component(constructor: ComponentType<any>): void;
export function component(options: ComponentOptions): (constructor: ComponentType<any>) => void;
export function component(arg: ComponentType<any> | ComponentOptions):
    ((constructor: ComponentType<any>) => void) | void {
  if (typeof arg === 'function') {
    componentTypes.push(arg);
  } else {
    return (constructor: ComponentType<any>) => {
      constructor.options = arg;
      componentTypes.push(constructor);
    };
  }
}
