import type {ComponentType} from './component';
import {Dispatcher, WorldOptions} from './dispatcher';
import {System} from './system';


class BuildSystem extends System {
  __callback: (system: System) => void;

  constructor() {
    super();
    this.__rwMasks.read = undefined;
    this.__rwMasks.write = undefined;
  }

  execute() {
    this.__callback(this);
  }
}


export class World {
  private readonly __dispatcher: Dispatcher;
  private readonly __buildSystem = new BuildSystem();

  constructor(options: WorldOptions) {
    this.__dispatcher = new Dispatcher(options);
  }

  build(callback: (system: System) => void): void {
    this.__buildSystem.__callback = callback;
    this.__dispatcher.executeAdHoc(this.__buildSystem);
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
