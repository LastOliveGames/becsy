import type {ComponentType} from './component';
import type {Entity, EntityId} from './entity';
import type {System} from './system';

type MaskKind = '__withMask' | '__withoutMask' | '__watchMask' | '__refMask';

class QueryBuilder {
  protected lastType: ComponentType<any>;

  constructor(
    private readonly callback: (q: QueryBuilder) => void,
    protected readonly query: Query,
    protected readonly system: System
  ) {}

  __build(): void {
    try {
      this.callback(this);
    } catch (e) {
      e.message = `Failed to build query in system ${this.system.name}: ${e.message}`;
      throw e;
    }
  }

  with(type: ComponentType<any>): this {
    return this.set('__withMask', type);
  }

  without(type: ComponentType<any>): this {
    return this.set('__withoutMask', type);
  }

  also(type: ComponentType<any>): this {
    this.lastType = type;
    return this;
  }

  get track(): this {
    return this.set('__watchMask');
  }

  get read(): this {
    return this.set(this.system.__readMask);
  }

  get write(): this {
    this.set(this.system.__readMask);
    return this.set(this.system.__writeMask);
  }

  protected set(
    mask: MaskKind | number[], type?: ComponentType<any>, onlyOne?: string
  ): this {
    if (!type) type = this.lastType;
    if (!type) throw new Error('No component type to apply query modifier to');
    this.lastType = type;
    if (typeof mask === 'string') {
      if (onlyOne && this.query[mask]) throw new Error(`Only one ${onlyOne} allowed`);
      if (!this.query[mask]) this.query[mask] = [];
      mask = this.query[mask]!;
    } else if (onlyOne && mask.some(n => n !== 0)) {
      throw new Error(`Only one ${onlyOne} allowed`);
    }
    this.system.__systems.entities.extendMaskAndSetFlag(mask, type);
    return this;
  }
}


export class MainQueryBuilder extends QueryBuilder {
  private joinBuilders: {[name: string]: JoinQueryBuilder} = {};

  constructor(callback: (q: MainQueryBuilder) => void, query: MainQuery, system: System) {
    super(callback as any, query, system);
  }

  __build(): void {
    super.__build();
    try {
      for (const name in this.joinBuilders) this.joinBuilders[name].__build();
    } catch (e) {
      e.message = `Failed to build query in system ${this.system.name}: ${e.message}`;
      throw e;
    }
  }

  join(name: string, joinCallback: (q: JoinQueryBuilder) => void): this {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    const joinQuery = new JoinQuery(this.system);
    (this.query as MainQuery).__joins[name] = joinQuery;
    this.joinBuilders[name] =
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      new JoinQueryBuilder(joinCallback, joinQuery, this.system);
    return this;
  }
}


class JoinQueryBuilder extends QueryBuilder {
  constructor(callback: (q: JoinQueryBuilder) => void, query: JoinQuery, system: System) {
    super(callback as any, query, system);
  }

  ref(prop?: string): this {
    this.set('__refMask', this.lastType, 'ref');
    this.set(this.system.__readMask);
    (this.query as JoinQuery)['refProp'] = prop;  // eslint-disable-line dot-notation
    return this;
  }

}


abstract class Query {
  protected __withMask: number[] | undefined;
  protected __withoutMask: number[] | undefined;
  protected __watchMask: number[] | undefined;
  protected __refMask: number[] | undefined;  // should be in JoinQuery, but type system...

  constructor(protected readonly system: System) { }

}

export class MainQuery extends Query {
  readonly __joins: {[name: string]: JoinQuery} = {};

  get all(): Iterable<Entity> {
    const entities = this.system.__systems.entities;
    return this.iterate(
      id => entities.matchCurrent(id, this.__withMask, this.__withoutMask));
  }

  get added(): Iterable<Entity> {
    const entities = this.system.__systems.entities;
    return this.iterate(
      id =>
        entities.matchCurrent(id, this.__withMask, this.__withoutMask) &&
        !entities.matchPrevious(id, this.__withMask, this.__withoutMask)
    );
  }

  get removed(): Iterable<Entity> {
    const entities = this.system.__systems.entities;
    return this.iterate(
      id =>
        !entities.matchCurrent(id, this.__withMask, this.__withoutMask) &&
        entities.matchPrevious(id, this.__withMask, this.__withoutMask)
    );
  }

  get changed(): Iterable<Entity> {
    const entities = this.system.__systems.entities;
    return this.iterate(
      id =>
        entities.matchCurrent(id, this.__withMask, this.__withoutMask) &&
        entities.matchMutated(id, this.__watchMask)
    );
  }

  private iterate(predicate: (id: EntityId) => boolean): Iterable<Entity> {
    return this.system.__systems.entities.iterate(
      this.system, predicate, () => {this.system.__releaseEntities();}
    );
  }
}


class JoinQuery extends Query {
  private refProp: string | undefined;
}
