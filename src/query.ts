import {Bitset} from './datatypes/bitset';
import type {ComponentType} from './component';
import {Entity, EntityId, extendMaskAndSetFlag} from './entity';
import type {SystemBox} from './system';
import {ArrayEntityList, EntityList, PackedArrayEntityList} from './datatypes/entitylist';

type MaskKind = 'withMask' | 'withoutMask' | 'trackMask';

enum QueryFlavor {
  current = 1, added = 2, removed = 4, changed = 8, addedOrChanged = 16, changedOrRemoved = 32,
  addedChangedOrRemoved = 64
}

type QueryFlavorName = keyof typeof QueryFlavor;
type TransientQueryFlavorName =
  'added' | 'removed' | 'changed' | 'addedOrChanged' | 'changedOrRemoved' | 'addedChangedOrRemoved';

const transientFlavorsMask =
  QueryFlavor.added | QueryFlavor.removed | QueryFlavor.changed | QueryFlavor.addedOrChanged |
  QueryFlavor.changedOrRemoved | QueryFlavor.addedChangedOrRemoved;
const changedFlavorsMask =
  QueryFlavor.changed | QueryFlavor.addedOrChanged | QueryFlavor.changedOrRemoved |
  QueryFlavor.addedChangedOrRemoved;


export class QueryBox {
  results: Partial<Record<QueryFlavorName, EntityList>> & {current?: PackedArrayEntityList} = {};
  flavors = 0;
  withMask: number[] | undefined;
  withoutMask: number[] | undefined;
  trackMask: number[] | undefined;
  hasTransientResults: boolean;
  hasChangedResults: boolean;
  private currentEntities: Bitset | undefined;
  private processedEntities: Bitset;
  private changedEntities: Bitset | undefined;

  constructor(query: Query, private readonly system: SystemBox) {
    query.__results = this.results;
    query.__systemName = system.name;
  }

  complete(): void {
    const dispatcher = this.system.dispatcher;
    this.hasTransientResults = Boolean(this.flavors & transientFlavorsMask);
    this.hasChangedResults = Boolean(this.flavors & changedFlavorsMask);
    CHECK: if (this.withMask && this.withoutMask) {
      const minLength = Math.min(this.withMask.length, this.withoutMask.length);
      for (let i = 0; i < minLength; i++) {
        if ((this.withMask[i] & this.withoutMask[i]) !== 0) {
          throw new Error(
            'Query must not list a component type in both `with` and `without` clauses');
        }
      }
    }
    CHECK: if (this.hasChangedResults && !this.trackMask) {
      throw new Error(`Query for changed entities must track at least one component`);
    }
    if (this.flavors & QueryFlavor.current) {
      this.results.current =
        new PackedArrayEntityList(dispatcher.registry.pool, dispatcher.maxEntities);
    } else {
      this.currentEntities = new Bitset(dispatcher.maxEntities);
    }
    this.processedEntities = new Bitset(dispatcher.maxEntities);
    if (this.hasTransientResults) this.allocateTransientResultLists();
    if (this.flavors) this.system.shapeQueries.push(this);
    if (this.hasChangedResults) {
      this.changedEntities = new Bitset(dispatcher.maxEntities);
      this.system.writeQueries.push(this);
    }
  }

  private allocateTransientResultLists(): void {
    if (this.flavors & QueryFlavor.added) this.allocateResult('added');
    if (this.flavors & QueryFlavor.removed) this.allocateResult('removed');
    if (this.flavors & QueryFlavor.changed) this.allocateResult('changed');
    if (this.flavors & QueryFlavor.addedOrChanged) this.allocateResult('addedOrChanged');
    if (this.flavors & QueryFlavor.changedOrRemoved) this.allocateResult('changedOrRemoved');
    if (this.flavors & QueryFlavor.addedChangedOrRemoved) {
      this.allocateResult('addedChangedOrRemoved');
    }
  }

  private allocateResult(name: TransientQueryFlavorName): void {
    const dispatcher = this.system.dispatcher;
    this.results[name] = new ArrayEntityList(dispatcher.registry.pool);
  }

  clearTransientResults(): void {
    if (!this.hasTransientResults) return;
    this.results.added?.clear();
    this.results.removed?.clear();
    this.results.changed?.clear();
    this.results.addedOrChanged?.clear();
    this.results.changedOrRemoved?.clear();
    this.results.addedChangedOrRemoved?.clear();
    this.changedEntities?.clear();
  }

  clearAllResults(): void {
    this.clearTransientResults();
    this.results.current?.clear();
  }

  clearProcessedEntities(): void {
    this.processedEntities.clear();
  }

  handleShapeUpdate(id: EntityId): void {
    if (this.processedEntities.get(id)) return;
    this.processedEntities.set(id);
    const registry = this.system.dispatcher.registry;
    const oldMatch = this.results.current?.has(id) ?? this.currentEntities!.get(id);
    const newMatch = registry.matchShape(id, this.withMask, this.withoutMask);
    if (newMatch && !oldMatch) {
      this.currentEntities?.set(id);
      this.changedEntities?.set(id);
      this.results.current?.add(id);
      this.results.added?.add(id);
      this.results.addedOrChanged?.add(id);
      this.results.addedChangedOrRemoved?.add(id);
    } else if (!newMatch && oldMatch) {
      this.currentEntities?.unset(id);
      this.changedEntities?.set(id);
      this.results.current?.remove(id);
      this.results.removed?.add(id);
      this.results.changedOrRemoved?.add(id);
      this.results.addedChangedOrRemoved?.add(id);
    }
  }

  handleWrite(id: EntityId, componentFlagOffset: number, componentFlagMask: number): void {
    if (!this.changedEntities!.get(id) &&
      this.system.dispatcher.registry.matchShape(id, this.withMask, this.withoutMask) &&
      (this.trackMask![componentFlagOffset] ?? 0) & componentFlagMask
    ) {
      this.changedEntities!.set(id);
      this.results.changed?.add(id);
      this.results.addedOrChanged?.add(id);
      this.results.changedOrRemoved?.add(id);
      this.results.addedChangedOrRemoved?.add(id);
    }
  }

}


/**
 * A fluent DSL for specifying a family of queries over the world's entities.
 *
 * Each query has a number of aspects:
 * 1. What components an entity must (`with`) and must not (`without`) have to be selected.
 * 2. Whether to return all `current` entities that satisfy the query, only various deltas from the
 *    last frame (`added`, `removed`, `changed`, etc.).  It's permitted and encouraged to declare
 *    multiple such variants on a single query if needed.  For the delta queries, each entity will
 *    be compared against the query's value in the previous frame, so an entity that changes state
 *    and changes back again between system executions will not be selected.
 * 3. Which component types the query will read and write.  This doesn't affect the results of the
 *    query but is used to order and deconflict systems.
 */
export class QueryBuilder {
  private __query: QueryBox;
  private __system: SystemBox;
  protected __lastTypes: ComponentType<any>[];

  constructor(
    private readonly __callback: (q: QueryBuilder) => void,
    private readonly __userQuery: Query) {}

  __build(system: SystemBox): void {
    try {
      this.__system = system;
      this.__query = new QueryBox(this.__userQuery, system);
      this.__callback(this);
      if (!this.__query.withMask && this.__query.flavors) {
        this.set('withMask', [this.__system.dispatcher.registry.Alive]);
      }
      this.__query.complete();
    } catch (e: any) {
      e.message = `Failed to build query in system ${system.name}: ${e.message}`;
      throw e;
    }
  }

  // TODO: support partitioned queries in stateless systems

  /**
   * A noop connector to make a query definition read better.
   */
  get and(): this {
    return this;
  }

  /**
   * A noop connector to make a query definition read better.
   */
  get but(): this {
    return this;
  }

  /**
   * A noop connector to make a query definition read better.
   */
  get also(): this {
    return this;
  }

  /**
   * Requests the maintenance of a list of all entities that currently satisfy the query.  This is
   * the most common use of queries.
   */
  get current(): this {
    this.__query.flavors |= QueryFlavor.current;
    return this;
  }

  /**
   * Requests that a list of all entities that newly satisfy the query be made available each frame.
   */
  get added(): this {
    this.__query.flavors |= QueryFlavor.added;
    return this;
  }

  /**
   * Requests that a list of all entities that no longer satisfy the query be made available each
   * frame.
   */
  get removed(): this {
    this.__query.flavors |= QueryFlavor.removed;
    return this;
  }

  /**
   * Requests that a list of all entities that were recently written to and satisfy the query be
   * made available each frame.  You must additionally specify which components the write detection
   * should be sensitive to using `track`.
   */
  get changed(): this {
    this.__query.flavors |= QueryFlavor.changed;
    return this;
  }

  /**
   * A combination of the `added` and `changed` query types, with the advantage that an entity that
   * satisfies both will only appear once.
   */
  get addedOrChanged(): this {
    this.__query.flavors |= QueryFlavor.addedOrChanged;
    return this;
  }

  /**
   * A combination of the `changed` and `removed` query types, with the advantage that an entity
   * that satisfies both will only appear once.
   */
  get changedOrRemoved(): this {
    this.__query.flavors |= QueryFlavor.changedOrRemoved;
    return this;
  }

  /**
   * A combination of the `added`, `changed`, and `removed` query types, with the advantage that an
   * entity that satisfies multiple ones will only appear once.
   */
  get addedChangedOrRemoved(): this {
    this.__query.flavors |= QueryFlavor.addedChangedOrRemoved;
    return this;
  }

  /**
   * Constrains the query to entities that possess components of all the given types.  All given
   * types are also marked as `read`.
   * @param types The types of components required to match the query.
   */
  with(...types: ComponentType<any>[]): this {
    this.set(this.__system.rwMasks.read, types);
    this.set('withMask');
    return this;
  }

  /**
   * Constrains the query to entities that don't possess components of any of the given types.  All
   * given types are also marked as `read`.
   * @param types The types of components that must not be present to match the query.
   */
  without(...types: ComponentType<any>[]): this {
    this.set(this.__system.rwMasks.read, types);
    this.set('withoutMask');
    return this;
  }

  /**
   * Marks all the given component types as `read`.
   * @param types The types of components that the system will read, but that don't constrain the
   * query.
   */
  using(...types: ComponentType<any>[]): this {
    this.set(this.__system.rwMasks.read, types);
    return this;
  }

  /**
   * Marks all component types in the world as `read`.  This can be modified with a `.write` as
   * usual, and may be useful in "sweeper" systems that want to be able to, e.g., delete any entity
   * without having to worry what it might hold refs to or what components might have backrefs
   * pointing to it.
   */
  get usingAll(): this {
    // All types except Alive, which is always at index 0.
    this.set(this.__system.rwMasks.read, this.__system.dispatcher.registry.types.slice(1));
    return this;
  }

  /**
   * Marks the most recently mentioned component types as trackable for `changed` query flavors.
   */
  get track(): this {
    this.set('trackMask');
    for (const type of this.__lastTypes) type.__binding!.trackedWrites = true;
    return this;
  }

  /**
   * Marks the most recently mentioned component types as read by the system.  Redundant, since any
   * mention of component types automatically marks them as read, but can be included for clarity.
   */
  get read(): this {
    return this;
  }

  /**
   * Marks the most recently mentioned component types as written by the system.  This declaration
   * is enforced: you will only be able to write to component of types thus declared.  You should
   * try to declare the minimum writable set that your system will need to improve ordering and
   * concurrent performance.
   */
  get write(): this {
    this.set(this.__system.rwMasks.write);
    return this;
  }

  // TODO: add support for create mode; precedence like write, but systems can run concurrently if
  // component has inelastic storage and atomic component allocation

  private set(
    mask: MaskKind | number[] | undefined, types?: ComponentType<any>[]
  ): void {
    if (!mask) return;
    if (!types) types = this.__lastTypes;
    if (!types) throw new Error('No component type to apply query modifier to');
    this.__lastTypes = types;
    if (typeof mask === 'string') {
      if (!this.__query[mask]) this.__query[mask] = [];
      mask = this.__query[mask]!;
    }
    const readMask = mask === this.__system.rwMasks.read;
    const writeMask = mask === this.__system.rwMasks.write;
    const shapeMask = mask === this.__query.withMask || mask === this.__query.withoutMask;
    const trackMask = mask === this.__query.trackMask;
    const map =
      readMask ? this.__system.dispatcher.planner.readers! :
        writeMask ? this.__system.dispatcher.planner.writers! : undefined;
    for (const type of types) {
      extendMaskAndSetFlag(mask, type);
      if (map) map.get(type)!.add(this.__system);
      if (shapeMask) this.categorize(this.__system.shapeQueriesByComponent, type);
      if (trackMask) this.categorize(this.__system.writeQueriesByComponent, type);
    }
  }

  private categorize(index: QueryBox[][], type: ComponentType<any>): void {
    const id = type.id!;
    if (!index[id]) index[id] = [];
    if (!index[id].includes(this.__query)) index[id].push(this.__query);
  }
}


export class Query {
  __results: Partial<Record<QueryFlavorName, EntityList>> & {current?: PackedArrayEntityList};
  __systemName: string;

  // TODO: add an API for freezing/thawing a query

  /**
   * A list of all entities that match this query as of the beginning of the system's current (or
   * last) execution.
   *
   * The order of entities in this list is generally unspecified. The exception is that if your
   * query has no `or` clauses (currenty unsupported anyway) and you used
   * {@link System.createEntity} to create your entities and never added or removed components from
   * them thereafter, then those entities that match the query will be listed in the order they were
   * created.  (Though the order between systems that execute concurrently is still undefined.)
   *
   * You must not keep a reference to these entities beyond the local scope of a system's execution.
   * To obtain an object for long-term use please see {@link Entity.hold}.
   */
  get current(): readonly Entity[] {
    CHECK: this.__checkList('current');
    return this.__results.current!.entities;
  }

  /**
   * A list of all entities that newly started matching this query between the system's current (or
   * last) and previous executions.
   *
   * The order of entities in this list is generally unspecified. The exception is that if your
   * query has no `or` clauses (currenty unsupported anyway) and you used
   * {@link System.createEntity} to create your entities and never added or removed components from
   * them thereafter, then those entities that match the query will be listed in the order they were
   * created.  (Though the ordering of entities created by systems that execute concurrently is
   * still undefined.)
   *
   * You must not keep a reference to these entities beyond the local scope of a system's execution.
   * To obtain an object for long-term use please see {@link Entity.hold}.
   */
  get added(): readonly Entity[] {
    CHECK: this.__checkList('added');
    return this.__results.added!.entities;
  }

  /**
   * A list of all entities that newly stopped matching this query between the system's current (or
   * last) and previous executions.
   *
   * The order of entities in this list is unspecified.
   *
   * You must not keep a reference to these entities beyond the local scope of a system's execution.
   * To obtain an object for long-term use please see {@link Entity.hold}.
   */
  get removed(): readonly Entity[] {
    CHECK: this.__checkList('removed');
    return this.__results.removed!.entities;
  }

  /**
   * A list of all entities that match this query as of the beginning of of the system's current (or
   * last) execution, and that had tracked components written to between the system's current (or
   * last) and previous executions.
   *
   * The order of entities in this list is unspecified.
   *
   * You must not keep a reference to these entities beyond the local scope of a system's execution.
   * To obtain an object for long-term use please see {@link Entity.hold}.
   */
  get changed(): readonly Entity[] {
    CHECK: this.__checkList('changed');
    return this.__results.changed!.entities;
  }

  /**
   * A list that combines `added` and `changed`, but without duplicate entities.
   *
   * The order of entities in this list is unspecified.
   *
   * You must not keep a reference to these entities beyond the local scope of a system's execution.
   * To obtain an object for long-term use please see {@link Entity.hold}.
   */
  get addedOrChanged(): readonly Entity[] {
    CHECK: this.__checkList('addedOrChanged');
    return this.__results.addedOrChanged!.entities;
  }

  /**
   * A list that combines `changed` and `removed`, but without duplicate entities.
   *
   * The order of entities in this list is unspecified.
   *
   * You must not keep a reference to these entities beyond the local scope of a system's execution.
   * To obtain an object for long-term use please see {@link Entity.hold}.
   */
  get changedOrRemoved(): readonly Entity[] {
    CHECK: this.__checkList('changedOrRemoved');
    return this.__results.changedOrRemoved!.entities;
  }

  /**
   * A list that combines `added`, `changed`, and `removed`, but without duplicate entities.
   *
   * The order of entities in this list is unspecified.
   *
   * You must not keep a reference to these entities beyond the local scope of a system's execution.
   * To obtain an object for long-term use please see {@link Entity.hold}.
   */
  get addedChangedOrRemoved(): readonly Entity[] {
    CHECK: this.__checkList('addedChangedOrRemoved');
    return this.__results.addedChangedOrRemoved!.entities;
  }

  private __checkList(flavor: QueryFlavorName): void {
    const list = this.__results[flavor];
    if (!list) {
      throw new Error(
        `Query '${flavor}' not configured, please add .${flavor} to your query definition in ` +
        `system ${this.__systemName}`);
    }
  }
}
