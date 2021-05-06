import type {ComponentType} from './component';
import {Log, LogPointer} from './datastructures';
import type {Entity, EntityId} from './entity';
import {
  COMPONENT_ID_BITS, ENTITY_ID_BITS, ENTITY_ID_MASK, FIELD_SEQ_BITS, MAX_NUM_COMPONENTS,
  MAX_NUM_FIELDS
} from './consts';
import type {Dispatcher} from './dispatcher';
import type {Registry} from './registry';


interface Selector {
  id: number;
  targetTypes: ComponentType<any>[];
  sourceType?: ComponentType<any>;
  matchType: boolean;
  matchSeq: boolean;
  sourceTypeId?: number;
  sourceSeq?: number;
}


class Tracker {
  readonly entities: Entity[] = [];
  private readonly tags: (number | number[] | Set<number>)[] | undefined;
  private entityIndex: number[] | undefined;
  private readonly registry: Registry;

  constructor(
    private readonly targetEntityId: number, private readonly selector: Selector,
    private readonly dispatcher: Dispatcher
  ) {
    const binding = selector.sourceType?.__binding;
    const precise =
      selector.matchType &&
      (selector.matchSeq || binding!.refFields.length === 1) &&
      !binding!.internallyIndexed;
    if (!precise) this.tags = [];
    this.registry = dispatcher.registry;
  }

  trackReference(
    entityId: EntityId, typeId: number, fieldSeq: number, internalIndex: number | undefined,
    trackChanges: boolean
  ): void {
    let index = this.getEntityIndex(entityId);
    if (index === undefined) index = this.addEntity(entityId, trackChanges);
    this.addTag(index, this.makeTag(typeId, fieldSeq, internalIndex));
  }

  trackDereference(
    entityId: EntityId, typeId: number, fieldSeq: number, internalIndex: number | undefined,
    trackChanges: boolean
  ): void {
    const index = this.getEntityIndex(entityId);
    DEBUG: if (index === undefined) throw new Error('Entity backref not tracked');
    const empty = this.removeTag(index, this.makeTag(typeId, fieldSeq, internalIndex));
    if (empty) this.removeEntity(index, entityId, trackChanges);
  }

  private getEntityIndex(entityId: EntityId): number | undefined {
    if (this.entityIndex) return this.entityIndex[entityId];
    const k = this.entities.findIndex(entity => entity.__id === entityId);
    if (k >= 0) return k;
  }

  private indexEntities(): void {
    DEBUG: if (this.entityIndex) throw new Error('Entities already indexed');
    this.entityIndex = new Array(this.dispatcher.maxEntities);
    for (let i = 0; i < this.entities.length; i++) {
      this.entityIndex[this.entities[i].__id] = i;
    }
  }

  private addTag(index: number, tag: number): void {
    if (!this.tags) return;
    const set = this.tags[index];
    if (set === undefined) {
      this.tags[index] = tag;
    } else if (typeof set === 'number') {
      DEBUG: if (set === tag) throw new Error('Ref already tracked');
      this.tags[index] = [set, tag];
    } else if (Array.isArray(set)) {
      DEBUG: if (set.includes(tag)) throw new Error('Ref already tracked');
      if (set.length >= 1000) {
        const actualSet = this.tags[index] = new Set(set);
        actualSet.add(tag);
      } else {
        set.push(tag);
      }
    } else {
      DEBUG: if (set.has(tag)) throw new Error('Ref already tracked');
      set.add(tag);
    }
  }

  private removeTag(index: number, tag: number): boolean {
    if (!this.tags) return true;  // precise mode
    const set = this.tags[index];
    DEBUG: if (set === undefined) throw new Error('Ref not tracked');
    if (typeof set === 'number') {
      DEBUG: if (set !== tag) throw new Error('Ref not tracked');
      delete this.tags[index];
      return true;
    }
    if (Array.isArray(set)) {
      const k = set.indexOf(tag);
      DEBUG: if (k === -1) throw new Error('Ref not tracked');
      set.splice(k, 1);
      return !this.tags.length;
    }
    set.delete(tag);
    return !set.size;
  }

  private makeTag(typeId: number, fieldSeq: number, internalIndex: number | undefined): number {
    return typeId | (fieldSeq << COMPONENT_ID_BITS) |
      (internalIndex === undefined ? 0 : (internalIndex << (COMPONENT_ID_BITS + FIELD_SEQ_BITS)));
  }

  private addEntity(entityId: EntityId, trackChanges: boolean): number {
    const index = this.entities.push(this.registry.pool.borrow(entityId));
    if (this.entityIndex) {
      this.entityIndex[entityId] = index;
    } else if (index > 100) {
      this.indexEntities();
    }
    if (trackChanges) this.trackBackrefsChange();
    return index;
  }

  private removeEntity(index: number, entityId: EntityId, trackChanges: boolean): void {
    this.registry.pool.return(entityId);
    const lastEntity = this.entities.pop();
    if (this.entityIndex) delete this.entityIndex[index];
    if (this.entities.length > index) {
      this.entities[index] = lastEntity!;
      if (this.entityIndex) this.entityIndex[lastEntity!.__id] = index;
    }
    if (trackChanges) this.trackBackrefsChange();
  }

  private trackBackrefsChange(): void {
    for (const targetType of this.selector.targetTypes) {
      if (targetType.__binding!.trackedWrites) {
        this.registry.trackWrite(this.targetEntityId, targetType);
      }
    }
  }
}


export class RefIndexer {
  private refLog?: Log;
  private refLogPointer?: LogPointer;
  private readonly selectorIdsBySourceKey = new Map<number, number>();
  private readonly selectors: Selector[] = [];
  private readonly trackers = new Map<number, Tracker>();

  constructor(
    private readonly dispatcher: Dispatcher,
    private readonly maxRefChangesPerFrame: number
  ) {}

  registerSelector(
    targetType?: ComponentType<any>, sourceType?: ComponentType<any>, sourceFieldSeq?: number
  ): number {
    if (!this.refLog) {
      this.refLog = new Log(this.maxRefChangesPerFrame, 'maxRefChangesPerFrame', true);
      this.refLogPointer = this.refLog.createPointer();
    }
    const selectorSourceKey = sourceType ?
      (typeof sourceFieldSeq === 'undefined' ?
        -2 - sourceType.id! : sourceType.id! | (sourceFieldSeq << COMPONENT_ID_BITS)
      ) : -1;
    let selectorId = this.selectorIdsBySourceKey.get(selectorSourceKey);
    if (selectorId === undefined) {
      const selector = {
        id: this.selectors.length, targetTypes: targetType ? [targetType] : [], sourceType,
        matchType: !!sourceType, matchSeq: typeof sourceFieldSeq !== 'undefined',
        sourceTypeId: sourceType?.id, sourceSeq: sourceFieldSeq
      };
      this.selectors.push(selector);
      selectorId = selector.id;
      this.selectorIdsBySourceKey.set(selectorSourceKey, selectorId);
      CHECK: if (selectorId > MAX_NUM_COMPONENTS) {
        throw new Error(`Too many distinct backrefs selectors`);
      }
    } else if (targetType) {
      this.selectors[selectorId].targetTypes.push(targetType);
    }
    return selectorId;
  }

  getBackrefs(entityId: EntityId, selectorId = 0): Entity[] {
    return this.getTracker(this.selectors[selectorId], entityId).entities;
  }

  trackRefChange(
    sourceId: EntityId, sourceType: ComponentType<any>, sourceSeq: number,
    sourceInternalIndex: number | undefined, oldTargetId: EntityId, newTargetId: EntityId
  ): void {
    DEBUG: if (!this.refLog) throw new Error(`Trying to trackRefChange without a refLog`);
    DEBUG: if (oldTargetId === newTargetId) throw new Error('No-op call to trackRefChange');
    if (oldTargetId !== -1) {
      this.pushRefLogEntry(
        sourceId, sourceType, sourceSeq, sourceInternalIndex, oldTargetId, false);
    }
    if (newTargetId !== -1) {
      this.pushRefLogEntry(sourceId, sourceType, sourceSeq, sourceInternalIndex, newTargetId, true);
    }
  }

  private pushRefLogEntry(
    sourceId: EntityId, sourceType: ComponentType<any>, sourceSeq: number,
    sourceInternalIndex: number | undefined, targetId: EntityId, referenced: boolean
  ): void {
    const internallyIndexed = typeof sourceInternalIndex !== 'undefined';
    DEBUG: if (internallyIndexed !== sourceType.__binding!.internallyIndexed) {
      throw new Error('Inconsistent internally indexed flag');
    }
    this.refLog!.push(sourceId | (sourceType.id! << ENTITY_ID_BITS));
    this.refLog!.push(
      targetId | (sourceSeq << ENTITY_ID_BITS) | (referenced ? 0 : 2 ** 31) |
      (internallyIndexed ? 2 ** 30 : 0));
    if (internallyIndexed) this.refLog!.push(sourceInternalIndex!);
  }

  private getTracker(selector: Selector, targetId: EntityId): Tracker {
    const trackerKey = targetId | (selector.id << ENTITY_ID_BITS);
    let tracker = this.trackers.get(trackerKey);
    if (!tracker) {
      tracker = new Tracker(targetId, selector, this.dispatcher);
      this.trackers.set(trackerKey, tracker);
    }
    return tracker;
  }

  // TODO: track stats for the refLog
  flush(): void {
    if (!this.refLog) return;
    while (true) {
      const [log, startIndex, endIndex, local] =
        this.refLog.processAndCommitSince(this.refLogPointer!);
      if (!log) break;
      for (let i = startIndex!; i < endIndex!; i += 2) {
        const entryPart1 = log[i], entryPart2 = log[i + 1];
        const sourceId = entryPart1 & ENTITY_ID_MASK;
        const sourceTypeId = entryPart1 >>> ENTITY_ID_BITS;
        const targetId = entryPart2 & ENTITY_ID_MASK;
        const sourceSeq = (entryPart2 >>> ENTITY_ID_BITS) & (MAX_NUM_FIELDS - 1);
        const referenced = (entryPart2 & 2 ** 31) === 0;
        const internallyIndexed = (entryPart2 & 2 ** 30) !== 0;
        const internalIndex = internallyIndexed ? log[i + 2] : undefined;
        if (internallyIndexed) i += 1;
        for (let j = 0; j < this.selectors.length; j++) {
          const selector = this.selectors[j];
          if ((!selector.matchType || selector.sourceTypeId === sourceTypeId) &&
              (!selector.matchSeq || selector.sourceSeq === sourceSeq)) {
            const tracker = this.getTracker(selector, targetId);
            if (referenced) {
              tracker.trackReference(sourceId, sourceTypeId, sourceSeq, internalIndex, local!);
            } else {
              tracker.trackDereference(sourceId, sourceTypeId, sourceSeq, internalIndex, local!);
            }
          }
        }
      }
    }
  }
}
