import type {ComponentType} from './component';
import {ControlOptions, Dispatcher, WorldOptions} from './dispatcher';
import type {Stats} from './stats';
import type {System} from './system';

const MAGIC_COOKIE = {};


export class World {
  private readonly __dispatcher: Dispatcher;

  static async create(options: WorldOptions): Promise<World> {
    const world = new World(options, MAGIC_COOKIE);
    await world.__dispatcher.initialize();
    return world;
  }

  private constructor(options: WorldOptions, magicCookie: any) {
    if (magicCookie !== MAGIC_COOKIE) {
      throw new Error(`Don't call World constructor directly; use World.create instead`);
    }
    this.__dispatcher = new Dispatcher(options);
  }

  build(callback: (system: System) => void): void {
    this.__dispatcher.executeFunction(callback);
  }

  createEntity(...initialComponents: (ComponentType<any> | any)[]): void {
    this.__dispatcher.createEntity(initialComponents);
  }

  execute(time?: number, delta?: number): Promise<void> {
    return this.__dispatcher.execute(time, delta);
  }

  control(options: ControlOptions): void {
    this.__dispatcher.control(options);
  }

  get stats(): Stats {
    return this.__dispatcher.stats;
  }
}

