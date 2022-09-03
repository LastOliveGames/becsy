import type {Component, ComponentType} from './component';


export class ComponentEnum {
  readonly __types: ComponentType<Component>[];
  __binding?: {
    shapeOffset: number;
    shapeMask: number;
    shapeShift: number;
  };

  constructor(readonly name: string, types: ComponentType<Component>[]) {
    this.__types = Array.from(new Set(types));
  }
}
