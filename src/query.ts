import {Bitset, LogPointer} from './datastructures';
import type {ComponentType} from './component';
import {Entity, ENTITY_ID_BITS, ENTITY_ID_MASK} from './entity';
import type {System} from './system';
import {ArrayEntityList, EntityList, SparseArrayEntityList} from './entitylists';

type MaskKind = '__withMask' | '__withoutMask' | '__trackMask' | '__refMask';

const enum QueryFlavor {
  all = 1, added = 2, removed = 4, changed = 8, addedOrChanged = 16, changedOrRemoved = 32,
  addedChangedOrRemoved = 64
}

type QueryFlavorName = keyof typeof QueryFlavor;

const changedFlavorsMask =
  QueryFlavor.changed | QueryFlavor.addedOrChanged | QueryFlavor.changedOrRemoved |
  QueryFlavor.addedChangedOrRemoved;


class QueryBuilder {
  protected __lastTypes: ComponentType<any>[];

  constructor(
    private readonly __callback: (q: QueryBuilder) => void,
    protected readonly __query: Query,
    protected readonly __system: System
  ) {}

  __build(): void {
    try {
      this.__callback(this);
      this.__query.__init();
    } catch (e) {
      e.message = `Failed to build query in system ${this.__system.name}: ${e.message}`;
      throw e;
    }
  }

  get and(): this {
    return this;
  }

  get but(): this {
    return this;
  }

  get all(): this {
    this.__query.__flavors |= QueryFlavor.all;
    return this;
  }

  get added(): this {
    this.__query.__flavors |= QueryFlavor.added;
    return this;
  }

  get removed(): this {
    this.__query.__flavors |= QueryFlavor.removed;
    return this;
  }

  get changed(): this {
    this.__query.__flavors |= QueryFlavor.changed;
    return this;
  }

  get addedOrChanged(): this {
    this.__query.__flavors |= QueryFlavor.addedOrChanged;
    return this;
  }

  get changedOrRemoved(): this {
    this.__query.__flavors |= QueryFlavor.changedOrRemoved;
    return this;
  }

  get addedChangedOrRemoved(): this {
    this.__query.__flavors |= QueryFlavor.addedChangedOrRemoved;
    return this;
  }

  with(...types: ComponentType<any>[]): this {
    this.set(this.__system.__rwMasks.read, types);
    this.set('__withMask');
    return this;
  }

  without(...types: ComponentType<any>[]): this {
    this.set(this.__system.__rwMasks.read, types);
    this.set('__withoutMask', types);
    return this;
  }

  using(...types: ComponentType<any>[]): this {
    this.set(this.__system.__rwMasks.read, types);
    return this;
  }

  get track(): this {
    this.set('__trackMask');
    return this;
  }

  get read(): this {
    return this;
  }

  get write(): this {
    this.set(this.__system.__rwMasks.write);
    return this;
  }

  protected set(
    mask: MaskKind | number[], types?: ComponentType<any>[], onlyOne?: string
  ): void {
    if (!types) types = this.__lastTypes;
    if (!types) throw new Error('No component type to apply query modifier to');
    this.__lastTypes = types;
    if (typeof mask === 'string') {
      if (onlyOne && this.__query[mask]) throw new Error(`Only one ${onlyOne} allowed`);
      if (!this.__query[mask]) this.__query[mask] = [];
      mask = this.__query[mask]!;
    } else if (onlyOne && mask.some(n => n !== 0)) {
      throw new Error(`Only one ${onlyOne} allowed`);
    }
    for (const type of types) this.__system.__dispatcher.entities.extendMaskAndSetFlag(mask, type);
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
      e.message = `Failed to build query in system ${this.__system.name}: ${e.message}`;
      throw e;
    }
  }

  join(name: string, joinCallback: (q: JoinQueryBuilder) => void): this {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    const joinQuery = new JoinQuery(this.__system);
    (this.__query as MainQuery).__joins[name] = joinQuery;
    this.joinBuilders[name] =
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      new JoinQueryBuilder(joinCallback, joinQuery, this.__system);
    return this;
  }
}


class JoinQueryBuilder extends QueryBuilder {
  constructor(callback: (q: JoinQueryBuilder) => void, query: JoinQuery, system: System) {
    super(callback as any, query, system);
  }

  ref(prop?: string): this {
    this.set('__refMask', undefined, 'ref');
    (this.__query as JoinQuery).__refProp = prop;
    return this;
  }

}


abstract class Query {
  __flavors = 0;
  __withMask: number[] | undefined;
  __withoutMask: number[] | undefined;
  __trackMask: number[] | undefined;
  __refMask: number[] | undefined;  // should be in JoinQuery, but type system...

  constructor(protected readonly __system: System) {}

  abstract __init(): void;

}

export class MainQuery extends Query {
  readonly __joins: {[name: string]: JoinQuery} = {};
  private lastExecutionTime: number;

  private results: Partial<Record<QueryFlavorName, EntityList>> = {};
  private processedEntities: Bitset;
  private currentEntities: Bitset;
  private shapeLogPointer: LogPointer;
  private writeLogPointer: LogPointer;

  private executeQueries(): void {
    if (!this.__flavors ||
        this.lastExecutionTime && this.lastExecutionTime === this.__system.time) return;
    this.lastExecutionTime = this.__system.time;
    this.clearTransientResults();
    this.computeShapeResults();
    this.computeWriteResults();
  }

  __init(): void {
    this.initPointers();
    this.allocateBuffers();
  }

  private initPointers(): void {
    const dispatcher = this.__system.__dispatcher;
    this.shapeLogPointer = dispatcher.shapeLog.createPointer();
    this.writeLogPointer = dispatcher.writeLog.createPointer();
  }

  private allocateBuffers(): void {
    const dispatcher = this.__system.__dispatcher;
    this.processedEntities = new Bitset(dispatcher.maxEntityId);
    this.currentEntities = new Bitset(dispatcher.maxEntityId);
    if (this.__flavors & QueryFlavor.all) this.results.all = new SparseArrayEntityList(dispatcher);
    // TODO: use pooled result buffers
    if (this.__flavors & QueryFlavor.added) this.allocateResult('added');
    if (this.__flavors & QueryFlavor.removed) this.allocateResult('removed', true);
    if (this.__flavors & QueryFlavor.changed) this.allocateResult('changed');
    if (this.__flavors & QueryFlavor.addedOrChanged) this.allocateResult('addedOrChanged');
    if (this.__flavors & QueryFlavor.changedOrRemoved) this.allocateResult('changedOrRemoved');
    if (this.__flavors & QueryFlavor.addedChangedOrRemoved) {
      this.allocateResult('addedChangedOrRemoved', true);
    }
  }

  private allocateResult(name: keyof typeof QueryFlavor, includeRemovedComponents?: boolean): void {
    const dispatcher = this.__system.__dispatcher;
    this.results[name] = new ArrayEntityList(dispatcher);
  }

  private clearTransientResults(): void {
    this.processedEntities.clear();
    if (this.results.added) this.results.added.clear();
    if (this.results.removed) this.results.removed.clear();
    if (this.results.changed) this.results.changed.clear();
    if (this.results.addedOrChanged) this.results.addedOrChanged.clear();
    if (this.results.changedOrRemoved) this.results.changedOrRemoved.clear();
    if (this.results.addedChangedOrRemoved) this.results.addedChangedOrRemoved.clear();
  }

  private computeShapeResults(): void {
    const entities = this.__system.__dispatcher.entities;
    for (const id of this.__system.__dispatcher.shapeLog.processSince(this.shapeLogPointer)) {
      if (!this.processedEntities.get(id)) {
        this.processedEntities.set(id);
        const oldMatch = this.currentEntities.get(id);
        const newMatch = entities.matchShape(id, this.__withMask, this.__withoutMask);
        if (newMatch && !oldMatch) {
          this.currentEntities.set(id);
          this.results.all?.add(id);
          this.results.added?.add(id);
          this.results.addedOrChanged?.add(id);
          this.results.addedChangedOrRemoved?.add(id);
        } else if (!newMatch && oldMatch) {
          this.currentEntities.unset(id);
          this.results.all?.remove(id);
          this.results.removed?.add(id);
          this.results.changedOrRemoved?.add(id);
          this.results.addedChangedOrRemoved?.add(id);
        }
      }
    }
  }

  private computeWriteResults(): void {
    if (!(this.__flavors & changedFlavorsMask) || !this.__trackMask) return;
    for (const entry of this.__system.__dispatcher.writeLog.processSince(this.writeLogPointer)) {
      const entityId = entry & ENTITY_ID_MASK;
      if (!this.processedEntities.get(entityId)) {
        const componentId = entry >>> ENTITY_ID_BITS;
        // Manually recompute offset and mask instead of looking up controller.
        if ((this.__trackMask[componentId >> 5] ?? 0) & (1 << (componentId & 31))) {
          this.processedEntities.set(entityId);
          this.results.changed?.add(entityId);
          this.results.addedOrChanged?.add(entityId);
          this.results.changedOrRemoved?.add(entityId);
          this.results.addedChangedOrRemoved?.add(entityId);
        }
      }
    }
  }

  get all(): Iterable<Entity> {
    return this.iterate('all');
  }

  get added(): Iterable<Entity> {
    return this.iterate('added');
  }

  get removed(): Iterable<Entity> {
    return this.iterate('removed', true);
  }

  get changed(): Iterable<Entity> {
    return this.iterate('changed');
  }

  get addedOrChanged(): Iterable<Entity> {
    return this.iterate('addedOrChanged');
  }

  get addedChangedOrRemoved(): Iterable<Entity> {
    return this.iterate('addedChangedOrRemoved', true);
  }

  private iterate(flavor: QueryFlavorName, includeRemovedComponents?: boolean): Iterable<Entity> {
    this.executeQueries();
    const list = this.results[flavor];
    if (!list) {
      throw new Error(
        `Query '${flavor}' not configured, please add .${flavor} to your query definition in ` +
        `system ${this.__system.name}`);
    }
    return list.iterate(includeRemovedComponents ? this.__withMask : undefined);
  }

}


class JoinQuery extends Query {
  __refProp: string | undefined;

  __init(): void {
    // TODO: do something here
  }
}
