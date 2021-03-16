import {Component, ComponentType} from './component';
import type {Type} from './type';

interface PropOptions<JSType> {
  type: Type<JSType>;
  default?: JSType;
}


export function prop<JSType>(practicalOptions: PropOptions<JSType> | Type<any>) {
  return function(target: any, name: string): void {
    if (target.constructor.schema === Component.schema) target.constructor.schema = {};
    const options: PropOptions<JSType> =
      'type' in practicalOptions ? practicalOptions : {type: practicalOptions};
    target.constructor.schema[name] = options;
  };
}


export const componentTypes: ComponentType<any>[] = [];

export function component(constructor: ComponentType<any>): void {
  componentTypes.push(constructor);
}
