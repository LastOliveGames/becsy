import type {ComponentType} from './component';
import {Bitset} from './datastructures';
import type {Dispatcher} from './dispatcher';
import type {Entity, ReadWriteMasks} from './entity';
import {TopQuery, TopQueryBuilder} from './query';


export interface SystemType {
  new(): System;
}


export abstract class System {
  readonly __rwMasks : ReadWriteMasks = {read: [], write: []};
  __dispatcher: Dispatcher;
  private __queryBuilders: TopQueryBuilder[] | null = [];
  private __queries: TopQuery[] = [];
  __removedEntities: Bitset;
  time: number;
  delta: number;

  get name(): string {return this.constructor.name;}

  query(buildCallback: (q: TopQueryBuilder) => void): TopQuery {
    const query = new TopQuery(this);
    this.__queries.push(query);
    const builder = new TopQueryBuilder(buildCallback, query, this);
    if (this.__queryBuilders) {
      this.__queryBuilders.push(builder);
    } else {
      builder.__build();
    }
    return query;
  }

  createEntity(...initialComponents: (ComponentType<any> | any)[]): Entity {
    return this.__dispatcher.createEntity(initialComponents);
  }

  abstract execute(): void;

  __init(dispatcher: Dispatcher): void {
    if (dispatcher === this.__dispatcher) return;
    if (this.__dispatcher) {
      throw new Error(`You can't reuse an instance of system ${this.name} in different worlds`);
    }
    this.__dispatcher = dispatcher;
    this.__removedEntities = new Bitset(dispatcher.maxEntities);
    for (const builder of this.__queryBuilders!) builder.__build();
    this.__queryBuilders = null;
  }

  __run(time: number, delta: number): void {
    this.time = time;
    this.delta = delta;
    for (const query of this.__queries) query.__startFrame();
    this.execute();
    for (const query of this.__queries) query.__endFrame();
  }
}
