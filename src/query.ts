import {Bitset} from './datatypes/bitset';
import {checkTypeDefined, ComponentType} from './component';
import {Entity, EntityId, extendMaskAndSetFlag, isMaskFlagSet} from './entity';
import type {SystemBox} from './system';
import {ArrayEntityList, EntityList, PackedArrayEntityList} from './datatypes/entitylist';
import {CheckError, InternalError} from './errors';
import type {ComponentEnum} from './enums';

type MaskKind = 'withMask' | 'withoutMask' | 'trackWritesMask';

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
const shapeFlavorsMask =
  QueryFlavor.added | QueryFlavor.removed | QueryFlavor.addedOrChanged |
  QueryFlavor.changedOrRemoved | QueryFlavor.addedChangedOrRemoved;

export interface TrackingMask {
  mask: number[];  // the withAny mask itself
  lastMatches: number[][] | undefined;  // don't track matches if undefined
  changed: boolean;  // side-channel to return value from matchAny; overwritten for each entity
}


export class QueryBox {
  results: Partial<Record<QueryFlavorName, EntityList>> & {current?: PackedArrayEntityList} = {};
  flavors = 0;
  withMask: number[] | undefined;
  withValues: number[] | undefined;
  withAnyRecords: TrackingMask[] | undefined;
  withoutMask: number[] | undefined;
  withoutEnumTypes: ComponentType<any>[];
  trackWritesMask: number[] | undefined;
  orderBy: (entity: Entity) => number;
  hasTransientResults: boolean;
  hasChangedResults: boolean;
  hasShapeResults: boolean;
  hasMatchTracking: boolean;
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
    this.hasShapeResults = Boolean(this.flavors & shapeFlavorsMask);
    this.hasMatchTracking = Boolean(this.withAnyRecords?.some(record => record.lastMatches));
    CHECK: {
      if (this.withMask && this.withoutMask) {
        const minLength = Math.min(this.withMask.length, this.withoutMask.length);
        for (let i = 0; i < minLength; i++) {
          if ((this.withMask[i] & this.withoutMask[i]) !== 0) {
            throw new CheckError(
              'Query must not list a component type in both `with` and `without` clauses');
          }
        }
      }
      if (this.withAnyRecords && this.withoutMask) {
        for (const {mask} of this.withAnyRecords) {
          const minLength = Math.min(mask.length, this.withoutMask.length);
          for (let i = 0; i < minLength; i++) {
            if ((mask[i] & this.withoutMask[i]) !== 0) {
              throw new CheckError(
                'Query must not list a component type in both `withAny` and `without` clauses');
            }
          }
        }
      }
      const hasTrackers =
        !!this.trackWritesMask || this.withAnyRecords?.some(item => item.lastMatches);
      if (this.hasChangedResults && !hasTrackers) {
        throw new CheckError(`Query for changed entities must track at least one component`);
      }
      if (!this.hasChangedResults && hasTrackers) {
        throw new CheckError(
          'You can only track components if you have a query for changed entities');
      }
    }
    if (this.flavors & QueryFlavor.current) {
      this.results.current =
        new PackedArrayEntityList(dispatcher.registry.pool, this.orderBy, dispatcher.maxEntities);
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
    this.results[name] = new ArrayEntityList(dispatcher.registry.pool, this.orderBy);
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
    const newMatch = registry.matchShape(
      id, this.withMask, this.withValues, this.withAnyRecords, this.withoutMask,
      this.withoutEnumTypes);
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
    } else if (newMatch && oldMatch && this.hasMatchTracking) {
      for (const record of this.withAnyRecords!) {
        if (record.changed) {
          this.changedEntities!.set(id);
          this.results.changed?.add(id);
          this.results.addedOrChanged?.add(id);
          this.results.changedOrRemoved?.add(id);
          this.results.addedChangedOrRemoved?.add(id);
          break;
        }
      }
    }
  }

  handleWrite(id: EntityId, componentFlagOffset: number, componentFlagMask: number): void {
    if (
      !this.changedEntities!.get(id) &&
      (this.hasShapeResults ?
        (this.results.current?.has(id) ?? this.currentEntities!.get(id)) :
        this.system.dispatcher.registry.matchShape(
          id, this.withMask, this.withValues, this.withAnyRecords, this.withoutMask,
          this.withoutEnumTypes)
      ) &&
      (this.trackWritesMask![componentFlagOffset] ?? 0) & componentFlagMask
    ) {
      this.changedEntities!.set(id);
      this.results.changed?.add(id);
      this.results.addedOrChanged?.add(id);
      this.results.changedOrRemoved?.add(id);
      this.results.addedChangedOrRemoved?.add(id);
    }
  }

  sort(): void {
    this.results.current?.sort();
    this.results.added?.sort();
    this.results.removed?.sort();
    this.results.changed?.sort();
    this.results.addedOrChanged?.sort();
    this.results.changedOrRemoved?.sort();
    this.results.addedChangedOrRemoved?.sort();
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
  protected __lastTypes: (ComponentType<any> | ComponentEnum)[];
  private __lastWasWithAny: boolean;

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
   * should be sensitive to using `trackWrites`.
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
   * Order query results in ascending order of the given function's output for each entity.
   * @example
   *   q.added.orderBy(entity => entity.ordinal)
   * @param transformer A function that transforms an entity to a number for sorting.
   */
  orderBy(transformer: (entity: Entity) => number): this {
    this.__query.orderBy = transformer;
    return this;
  }

  /**
   * Constrains the query to entities that possess components of all the given types.  All given
   * types are also marked as `read`.
   *
   * All `with` clauses are combined into a single `O(1)` check.
   *
   * You cannot pass in enums since by definition it's impossible for an entity to possess more than
   * one component from an enum.  See {@link QueryBuilder.withAny} instead.
   * @param types The types of components required to match the query.
   */
  with(...types: ComponentType<any>[]): this {
    this.set(this.__system.accessMasks.read, types);
    this.set('withMask');
    return this;
  }

  /**
   * Constrains the query to entities that possess a component of at least one of the given types.
   * All given types are also marked as `read`.
   *
   * Unlike `with`, `withAny` clauses are not combined; each is evaluated as a separate check, which
   * may affect performance.
   *
   * You cannot pass in enum component types, only whole enums.
   * @param types
   */
  withAny(...types: (ComponentType<any> | ComponentEnum)[]): this {
    CHECK: for (const type of types) {
      if (typeof type === 'function' && type.enum) {
        throw new CheckError(`Cannot use enum types in a withAny clause: ${type.name}`);
      }
    }
    this.set(this.__system.accessMasks.read, types);
    if (!this.__query.withAnyRecords) this.__query.withAnyRecords = [];
    const mask: number[] = [];
    this.__query.withAnyRecords.push({mask, lastMatches: undefined, changed: false});
    this.set(mask);
    return this;
  }

  /**
   * Constrains the query to entities that don't possess components of any of the given types.  All
   * given types are also marked as `read`.
   *
   * While you can pass in enum component types, evaluating such queries is inefficient (`O(n)` in
   * the number of enum types passed).  Passing in whole enums is fine, though (the query stays
   * `O(1)`).
   * @param types The types of components that must not be present to match the query.
   */
  without(...types: (ComponentType<any> | ComponentEnum)[]): this {
    this.set(this.__system.accessMasks.read, types);
    this.set('withoutMask');
    return this;
  }

  /**
   * Mentions some component types for follow-up modifiers.
   * @param types The types of components for follow-up modifiers, but that don't constrain the
   * query.
   */
  using(...types: (ComponentType<any> | ComponentEnum)[]): this {
    this.__lastTypes = types;
    return this;
  }

  /**
   * Makes all component types in the world available for follow-up modifiers.  This can be modified
   * with a `.write` as usual, and may be useful in "sweeper" systems that want to be able to, e.g.,
   * delete any entity without having to worry what it might hold refs to or what components might
   * have backrefs pointing to it.
   */
  get usingAll(): this {
    // All types except Alive, which is always at index 0.
    this.__lastTypes = this.__system.dispatcher.registry.types.slice(1);
    return this;
  }

  /**
   * Marks writes to the most recently mentioned component types as trackable for `changed` query
   * flavors.  An entity will be considered changed if any system called `write` on one of those
   * components since the last frame.
   */
  get trackWrites(): this {
    this.set('trackWritesMask');
    for (const type of this.__lastTypes) {
      if (typeof type === 'function') {
        type.__binding!.trackedWrites = true;
      } else {
        for (const enumType of type.__types) enumType.__binding!.trackedWrites = true;
      }
    }
    return this;
  }

  /**
   * Marks changes in the matching set of the immediately preceding `withAny` component types as
   * trackable for `changed` query flavors.  An entity will be considered changed if it matched the
   * query in the last frame and still matches it in the current frame, but satisfied the `withAny`
   * constraint with a different set of components.
   *
   * This tracking is particularly useful for detecting changing enum states, but can be applied to
   * any set of components.
   */
  get trackMatches(): this {
    if (!this.__lastWasWithAny) {
      throw new Error('You can only apply trackMatches to a withAny clause');
    }
    this.__query.withAnyRecords![this.__query.withAnyRecords!.length - 1].lastMatches = [];
    return this;
  }

  /**
   * Marks the most recently mentioned component types as read by the system.  This declaration
   * is enforced: you will only be able to read components of types thus declared.
   */
  get read(): this {
    this.set(this.__system.accessMasks.read);
    return this;
  }

  /**
   * Marks the most recently mentioned component types as created (and only created!) by the system.
   * This means that the component types will only be used in `createEntity` calls; they cannot be
   * otherwise read, checked for (`has` methods), or written.  It can run concurrently with other
   * `create` entitlements but counts as a `write` for purposes of system ordering.
   */
  get create(): this {
    this.set(this.__system.accessMasks.create);
    return this;
  }

  /**
   * Marks the most recently mentioned component types as indirectly updated by the system.  This
   * covers automatic change propagation to non-writable fields such as updates of `backrefs`
   * properties; however, it doesn't cover automatic clearing of refs to a deleted entity.  It can
   * run concurrently with other `read` and `update` entitlements but counts as a `write` for
   * purposes of system ordering.
   */
  get update(): this {
    this.set(this.__system.accessMasks.update);
    return this;
  }

  /**
   * Marks the most recently mentioned component types as read, written, created and/or updated by
   * the system.  This declaration is enforced: you will only be able to read and write to component
   * of types thus declared. You should try to declare the minimum writable set that your system
   * will need to improve ordering and concurrency.
   */
  get write(): this {
    this.set(this.__system.accessMasks.write);
    this.set(this.__system.accessMasks.read);
    this.set(this.__system.accessMasks.create);
    this.set(this.__system.accessMasks.update);
    return this;
  }

  private set(
    mask: MaskKind | number[] | undefined, types?: (ComponentType<any> | ComponentEnum)[]
  ): void {
    if (!mask) return;
    CHECK: if (types) {
      for (const type of types) checkTypeDefined(type);
    }
    if (!types) types = this.__lastTypes;
    DEBUG: if (!types) throw new InternalError('No component type to apply query modifier to');
    this.__lastTypes = types;
    if (typeof mask === 'string') {
      if (!this.__query[mask]) this.__query[mask] = [];
      mask = this.__query[mask]!;
    }
    this.__lastWasWithAny = this.__query.withAnyRecords?.some(item => item.mask === mask) ?? false;
    const readMask = mask === this.__system.accessMasks.read;
    const updateMask = mask === this.__system.accessMasks.update;
    const createMask = mask === this.__system.accessMasks.create;
    const writeMask = mask === this.__system.accessMasks.write;
    const withMask = mask === this.__query.withMask;
    const withoutMask = mask === this.__query.withoutMask;
    const shapeMask =
      mask === this.__query.withMask || mask === this.__query.withoutMask || this.__lastWasWithAny;
    const trackMask = mask === this.__query.trackWritesMask;
    const map =
      readMask ? this.__system.dispatcher.planner.readers! :
        writeMask || createMask || updateMask ? this.__system.dispatcher.planner.writers! :
          undefined;
    for (const type of types) {
      CHECK: {
        if (!isMaskFlagSet(this.__system.accessMasks.write!, type) && (
          readMask && isMaskFlagSet(this.__system.accessMasks.create!, type) ||
          createMask && isMaskFlagSet(this.__system.accessMasks.read!, type)
        )) {
          throw new CheckError(
            `Cannot combine create and read entitlements for component type ${type.name}; ` +
            `just use a write entitlement instead`
          );
        }
      }
      if (withoutMask && typeof type === 'function' && type.enum) {
        this.__query.withoutEnumTypes = this.__query.withoutEnumTypes ?? [];
        this.__query.withoutEnumTypes.push(type);
      } else {
        extendMaskAndSetFlag(mask, type);
        if (withMask) {
          if (!this.__query.withValues) this.__query.withValues = [];
          extendMaskAndSetFlag(this.__query.withValues!, type as ComponentType<any>, true);
        }
      }
      if (readMask) extendMaskAndSetFlag(this.__system.accessMasks.check!, type);
      if (typeof type === 'function') {
        if (map) map.get(type)!.add(this.__system);
        if (shapeMask) this.categorize(this.__system.shapeQueriesByComponent, type);
        if (trackMask) this.categorize(this.__system.writeQueriesByComponent, type);
      } else {
        for (const enumType of type.__types) {
          if (map) map.get(enumType)!.add(this.__system);
          if (shapeMask) this.categorize(this.__system.shapeQueriesByComponent, enumType);
          if (trackMask) this.categorize(this.__system.writeQueriesByComponent, enumType);
        }
      }
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
      throw new CheckError(
        `Query '${flavor}' not configured, please add .${flavor} to your query definition in ` +
        `system ${this.__systemName}`);
    }
  }
}
