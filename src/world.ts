import type {ComponentType} from './component';
import {ControlOptions, Dispatcher, WorldOptions} from './dispatcher';
import type {Stats} from './stats';
import type {System} from './system';


export class World {
  private readonly __dispatcher: Dispatcher;

  // TODO: change API to an async world creator
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

  control(options: ControlOptions): void {
    this.__dispatcher.control(options);
  }

  get stats(): Stats {
    return this.__dispatcher.stats;
  }
}
