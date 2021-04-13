import {Bitset, LogPointer} from './datastructures';
import type {ComponentType} from './component';
import {Entity, ENTITY_ID_BITS, ENTITY_ID_MASK} from './entity';
import type {System} from './system';
import {ArrayEntityList, EntityList, PackedArrayEntityList} from './entitylists';

type MaskKind = '__withMask' | '__withoutMask' | '__trackMask' | '__refMask';

const enum QueryFlavor {
  all = 1, added = 2, removed = 4, changed = 8, addedOrChanged = 16, changedOrRemoved = 32,
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

  get also(): this {
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
    for (const type of this.__lastTypes) type.__trackedWrites = true;
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
    mask: MaskKind | number[] | undefined, types?: ComponentType<any>[], onlyOne?: string
  ): void {
    if (!mask) return;
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
    for (const type of types) this.__system.__dispatcher.registry.extendMaskAndSetFlag(mask, type);
  }
}


export class TopQueryBuilder extends QueryBuilder {
  private joinBuilders: {[name: string]: JoinQueryBuilder} = {};

  constructor(callback: (q: TopQueryBuilder) => void, query: TopQuery, system: System) {
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
    (this.__query as TopQuery).__joins[name] = joinQuery;
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


export abstract class Query {
  __flavors = 0;
  __withMask: number[] | undefined;
  __withoutMask: number[] | undefined;
  __trackMask: number[] | undefined;
  __refMask: number[] | undefined;  // should be in JoinQuery, but type system...

  constructor(protected readonly __system: System) {}

  abstract __init(): void;

}

export class TopQuery extends Query {
  readonly __joins: {[name: string]: JoinQuery} = {};

  private __results:
    Partial<Record<QueryFlavorName, EntityList>> & {all?: PackedArrayEntityList} = {};

  private __hasTransientResults: boolean;
  __hasChangedResults: boolean;
  private __processedEntities: Bitset;
  private __currentEntities: Bitset | undefined;
  private __shapeLogPointer: LogPointer;
  private __writeLogPointer: LogPointer | undefined;

  __execute(): void {
    if (!this.__flavors) return;
    this.__processedEntities.clear();
    if (this.__hasTransientResults) this.__clearTransientResults();
    this.__computeShapeResults();
    this.__computeWriteResults();
  }

  __init(): void {
    const dispatcher = this.__system.__dispatcher;
    this.__hasTransientResults = Boolean(this.__flavors & transientFlavorsMask);
    this.__hasChangedResults = Boolean(this.__flavors & changedFlavorsMask);
    this.__shapeLogPointer = dispatcher.shapeLog.createPointer();
    this.__writeLogPointer = dispatcher.writeLog?.createPointer();
    this.__processedEntities = new Bitset(dispatcher.maxEntities);
    if (this.__flavors & QueryFlavor.all) {
      this.__results.all =
        new PackedArrayEntityList(dispatcher.registry.pool, dispatcher.maxEntities);
    } else {
      this.__currentEntities = new Bitset(dispatcher.maxEntities);
    }
    if (this.__hasTransientResults) this.__allocateTransientResultLists();
  }

  private __allocateTransientResultLists(): void {
    if (this.__flavors & QueryFlavor.added) this.__allocateResult('added');
    if (this.__flavors & QueryFlavor.removed) this.__allocateResult('removed');
    if (this.__flavors & QueryFlavor.changed) this.__allocateResult('changed');
    if (this.__flavors & QueryFlavor.addedOrChanged) this.__allocateResult('addedOrChanged');
    if (this.__flavors & QueryFlavor.changedOrRemoved) this.__allocateResult('changedOrRemoved');
    if (this.__flavors & QueryFlavor.addedChangedOrRemoved) {
      this.__allocateResult('addedChangedOrRemoved');
    }
  }

  private __allocateResult(name: TransientQueryFlavorName): void {
    const dispatcher = this.__system.__dispatcher;
    this.__results[name] = new ArrayEntityList(dispatcher.registry.pool);
  }

  private __clearTransientResults(): void {
    this.__results.added?.clear();
    this.__results.removed?.clear();
    this.__results.changed?.clear();
    this.__results.addedOrChanged?.clear();
    this.__results.changedOrRemoved?.clear();
    this.__results.addedChangedOrRemoved?.clear();
  }

  private __computeShapeResults(): void {
    const registry = this.__system.__dispatcher.registry;
    const shapeLog = this.__system.__dispatcher.shapeLog;
    let log: Uint32Array | undefined, startIndex: number | undefined, endIndex: number | undefined;
    while (true) {
      [log, startIndex, endIndex] = shapeLog.processSince(this.__shapeLogPointer);
      if (!log) break;
      for (let i = startIndex!; i < endIndex!; i++) {
        const id = log[i];
        if (!this.__processedEntities.get(id)) {
          this.__processedEntities.set(id);
          const oldMatch = this.__results.all?.has(id) ?? this.__currentEntities!.get(id);
          const newMatch = registry.matchShape(id, this.__withMask, this.__withoutMask);
          if (newMatch && !oldMatch) {
            this.__currentEntities?.set(id);
            this.__results.all?.add(id);
            this.__results.added?.add(id);
            this.__results.addedOrChanged?.add(id);
            this.__results.addedChangedOrRemoved?.add(id);
          } else if (!newMatch && oldMatch) {
            this.__currentEntities?.unset(id);
            this.__system.__removedEntities.set(id);
            this.__results.all?.remove(id);
            this.__results.removed?.add(id);
            this.__results.changedOrRemoved?.add(id);
            this.__results.addedChangedOrRemoved?.add(id);
          }
        }
      }
    }
  }

  private __computeWriteResults(): void {
    if (!(this.__flavors & changedFlavorsMask) || !this.__trackMask) return;
    const writeLog = this.__system.__dispatcher.writeLog!;
    let log: Uint32Array | undefined, startIndex: number | undefined, endIndex: number | undefined;
    while (true) {
      [log, startIndex, endIndex] = writeLog.processSince(this.__writeLogPointer!);
      if (!log) break;
      for (let i = startIndex!; i < endIndex!; i++) {
        const entry = log[i];
        const entityId = entry & ENTITY_ID_MASK;
        if (!this.__processedEntities.get(entityId)) {
          const componentId = entry >>> ENTITY_ID_BITS;
          // Manually recompute offset and mask instead of looking up controller.
          if ((this.__trackMask[componentId >> 5] ?? 0) & (1 << (componentId & 31))) {
            this.__processedEntities.set(entityId);
            this.__results.changed?.add(entityId);
            this.__results.addedOrChanged?.add(entityId);
            this.__results.changedOrRemoved?.add(entityId);
            this.__results.addedChangedOrRemoved?.add(entityId);
          }
        }
      }
    }
  }

  get all(): Entity[] {
    return this.__iterate('all');
  }

  get added(): Entity[] {
    return this.__iterate('added');
  }

  get removed(): Entity[] {
    return this.__iterate('removed');
  }

  get changed(): Entity[] {
    return this.__iterate('changed');
  }

  get addedOrChanged(): Entity[] {
    return this.__iterate('addedOrChanged');
  }

  get changedOrRemoved(): Entity[] {
    return this.__iterate('changedOrRemoved');
  }

  get addedChangedOrRemoved(): Entity[] {
    return this.__iterate('addedChangedOrRemoved');
  }

  private __iterate(flavor: QueryFlavorName): Entity[] {
    const list = this.__results[flavor];
    if (!list) {
      throw new Error(
        `Query '${flavor}' not configured, please add .${flavor} to your query definition in ` +
        `system ${this.__system.name}`);
    }
    return list.entities;
  }

}


class JoinQuery extends Query {
  __refProp: string | undefined;

  __init(): void {
    // TODO: do something here
  }
}
