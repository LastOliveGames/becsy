import type {ComponentType} from './component';
import {Dispatcher, WorldOptions} from './dispatcher';
import type {System} from './system';


export class World {
  private readonly __dispatcher: Dispatcher;

  constructor(options: WorldOptions) {
    this.__dispatcher = new Dispatcher(options);
  }

  build(callback: (system: System) => void): void {
    this.__dispatcher.executeFunction(callback);
  }

  createEntity(...initialComponents: (ComponentType<any> | any)[]): void {
    this.__dispatcher.createEntity(initialComponents);
  }

  execute(time?: number, delta?: number): void {
    this.__dispatcher.execute(time, delta);
  }

  get stats(): any {
    return this.__dispatcher.stats;
  }
}
