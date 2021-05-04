import {Bitset} from './datastructures';
import type {ComponentType} from './component';
import type {Entity, EntityId} from './entity';
import type {SystemBox} from './system';
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


export class QueryBox {
  results: Partial<Record<QueryFlavorName, EntityList>> & {all?: PackedArrayEntityList} = {};
  flavors = 0;
  __withMask: number[] | undefined;
  __withoutMask: number[] | undefined;
  __trackMask: number[] | undefined;
  __refMask: number[] | undefined;  // should be in JoinQuery, but type system...
  private hasTransientResults: boolean;
  hasChangedResults: boolean;
  private currentEntities: Bitset | undefined;
  private changedEntities: Bitset | undefined;

  constructor(private readonly query: Query, private readonly system: SystemBox) {
    query.__results = this.results;
    query.__systemName = system.name;
  }

  complete(): void {
    const dispatcher = this.system.dispatcher;
    this.hasTransientResults = Boolean(this.flavors & transientFlavorsMask);
    this.hasChangedResults = Boolean(this.flavors & changedFlavorsMask);
    CHECK: if (this.hasChangedResults && !this.__trackMask) {
      throw new Error(`Query for changed entities must track at least one component`);
    }
    if (this.flavors & QueryFlavor.all) {
      this.results.all =
        new PackedArrayEntityList(dispatcher.registry.pool, dispatcher.maxEntities);
    } else {
      this.currentEntities = new Bitset(dispatcher.maxEntities);
    }
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

  handleShapeUpdate(id: EntityId): void {
    const registry = this.system.dispatcher.registry;
    const oldMatch = this.results.all?.has(id) ?? this.currentEntities!.get(id);
    const newMatch = registry.matchShape(id, this.__withMask, this.__withoutMask);
    if (newMatch && !oldMatch) {
      this.currentEntities?.set(id);
      this.results.all?.add(id);
      this.results.added?.add(id);
      this.results.addedOrChanged?.add(id);
      this.results.addedChangedOrRemoved?.add(id);
    } else if (!newMatch && oldMatch) {
      this.currentEntities?.unset(id);
      this.results.all?.remove(id);
      this.results.removed?.add(id);
      this.results.changedOrRemoved?.add(id);
      this.results.addedChangedOrRemoved?.add(id);
    }
  }

  handleWrite(entityId: EntityId, componentFlagOffset: number, componentFlagMask: number): void {
    if (!this.changedEntities!.get(entityId) &&
      (this.__trackMask![componentFlagOffset] ?? 0) & componentFlagMask) {
      this.changedEntities!.set(entityId);
      this.results.changed?.add(entityId);
      this.results.addedOrChanged?.add(entityId);
      this.results.changedOrRemoved?.add(entityId);
      this.results.addedChangedOrRemoved?.add(entityId);
    }
  }

}


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
      this.__query.complete();
    } catch (e) {
      e.message = `Failed to build query in system ${system.name}: ${e.message}`;
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
    this.__query.flavors |= QueryFlavor.all;
    return this;
  }

  get added(): this {
    this.__query.flavors |= QueryFlavor.added;
    return this;
  }

  get removed(): this {
    this.__query.flavors |= QueryFlavor.removed;
    return this;
  }

  get changed(): this {
    this.__query.flavors |= QueryFlavor.changed;
    return this;
  }

  get addedOrChanged(): this {
    this.__query.flavors |= QueryFlavor.addedOrChanged;
    return this;
  }

  get changedOrRemoved(): this {
    this.__query.flavors |= QueryFlavor.changedOrRemoved;
    return this;
  }

  get addedChangedOrRemoved(): this {
    this.__query.flavors |= QueryFlavor.addedChangedOrRemoved;
    return this;
  }

  with(...types: ComponentType<any>[]): this {
    this.set(this.__system.rwMasks.read, types);
    this.set('__withMask');
    return this;
  }

  without(...types: ComponentType<any>[]): this {
    this.set(this.__system.rwMasks.read, types);
    this.set('__withoutMask', types);
    return this;
  }

  using(...types: ComponentType<any>[]): this {
    this.set(this.__system.rwMasks.read, types);
    return this;
  }

  get track(): this {
    this.set('__trackMask');
    for (const type of this.__lastTypes) type.__binding!.trackedWrites = true;
    return this;
  }

  get read(): this {
    return this;
  }

  get write(): this {
    const writeMask = this.__system.rwMasks.write;
    this.set(writeMask);
    for (const type of this.__lastTypes) {
      const extraMask = type.__binding!.backrefsWriteMask;
      for (let i = 0; i < extraMask.length; i++) {
        if (writeMask[i] === undefined) writeMask[i] = 0;
        writeMask[i] |= extraMask[i];
      }
    }
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
    for (const type of types) this.__system.dispatcher.registry.extendMaskAndSetFlag(mask, type);
  }
}


export class Query {
  __results: Partial<Record<QueryFlavorName, EntityList>> & {all?: PackedArrayEntityList};
  __systemName: string;

  get all(): Entity[] {
    CHECK: this.__checkList('all');
    return this.__results.all!.entities;
  }

  get added(): Entity[] {
    CHECK: this.__checkList('added');
    return this.__results.added!.entities;
  }

  get removed(): Entity[] {
    CHECK: this.__checkList('removed');
    return this.__results.removed!.entities;
  }

  get changed(): Entity[] {
    CHECK: this.__checkList('changed');
    return this.__results.changed!.entities;
  }

  get addedOrChanged(): Entity[] {
    CHECK: this.__checkList('addedOrChanged');
    return this.__results.addedOrChanged!.entities;
  }

  get changedOrRemoved(): Entity[] {
    CHECK: this.__checkList('changedOrRemoved');
    return this.__results.changedOrRemoved!.entities;
  }

  get addedChangedOrRemoved(): Entity[] {
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
