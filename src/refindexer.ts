import {checkTypeDefined, type ComponentType} from './component';
import {Log, type LogPointer} from './datatypes/log';
import {checkMask, type Entity, type EntityId} from './entity';
import {
  COMPONENT_ID_BITS, COMPONENT_ID_MASK, ENTITY_ID_BITS, ENTITY_ID_MASK, FIELD_SEQ_BITS,
  FIELD_SEQ_MASK, MAX_NUM_COMPONENTS,
  MAX_NUM_FIELDS
} from './consts';
import type {Dispatcher} from './dispatcher';
import type {Registry} from './registry';
import {CheckError, InternalError} from './errors';


interface Selector {
  id: number;
  targetTypes: ComponentType<any>[];
  trackStale: boolean;
  sourceType?: ComponentType<any>;
  matchType: boolean;
  matchSeq: boolean;
  sourceTypeId?: number;
  sourceSeq?: number;
}

enum Action {
  REFERENCE = 0, UNREFERENCE = 2 ** 30, RELEASE = 2 ** 31,
  UNREFERENCE_AND_RELEASE = 2 ** 30 | 2 ** 31
}

const ACTION_MASK = Action.UNREFERENCE_AND_RELEASE;


class Tracker {
  entities: Entity[] = [];
  private tags: (number | number[] | Set<number>)[] | undefined;
  private entityIndex: number[] | undefined;
  private clearing = false;
  private readonly registry: Registry;

  constructor(
    private readonly targetEntityId: EntityId, private readonly selector: Selector,
    private readonly trackStale: boolean, private readonly dispatcher: Dispatcher
  ) {
    const binding = selector.sourceType?.__binding;
    const precise =
      selector.matchType && (
        selector.matchSeq && !binding!.fields[selector.sourceSeq!].type.internallyIndexed ||
        binding!.refFields.length === 1 && !binding!.refFields[0].type.internallyIndexed
      );
    if (!precise) this.tags = [];
    this.registry = dispatcher.registry;
  }

  clearAllRefs(final: boolean): void {
    DEBUG: if (!this.tags) throw new InternalError('Unreferencing an untagged tracker');
    this.clearing = true;
    for (let i = 0; i < this.entities.length; i++) {
      const entityId = this.entities[i].__id;
      const set = this.tags[i];
      if (typeof set === 'number') {
        this.clearRef(entityId, set, final);
      } else {
        for (const tag of set) this.clearRef(entityId, tag, final);
      }
    }
    this.entities = [];
    if (this.tags) this.tags = [];
    this.entityIndex = undefined;
    this.clearing = false;
  }

  private clearRef(sourceId: EntityId, tag: number, final: boolean): void {
    const sourceTypeId = tag & COMPONENT_ID_MASK;
    const sourceSeq = (tag >>> COMPONENT_ID_BITS) & FIELD_SEQ_MASK;
    const internalIndex = tag >>> (COMPONENT_ID_BITS + FIELD_SEQ_BITS);
    const sourceType = this.registry.types[sourceTypeId];
    CHECK: checkMask(sourceType, this.registry.executingSystem, 'write');
    sourceType.__bind!(sourceId, true);
    sourceType.__binding!.fields[sourceSeq].clearRef!(final, this.targetEntityId, internalIndex);
  }

  trackReference(
    entityId: EntityId, typeId: number, fieldSeq: number, internalIndex: number | undefined,
    trackChanges: boolean
  ): void {
    DEBUG: if (this.clearing) {
      throw new InternalError('Cannot track a new reference while clearing tracker');
    }
    CHECK: if (trackChanges) this.checkUpdateMask();
    let index = this.getEntityIndex(entityId);
    if (index === undefined) index = this.addEntity(entityId, trackChanges);
    this.addTag(index, this.makeTag(typeId, fieldSeq, internalIndex));
  }

  trackUnreference(
    entityId: EntityId, typeId: number, fieldSeq: number, internalIndex: number | undefined,
    trackChanges: boolean
  ): void {
    if (this.clearing) return;
    CHECK: if (trackChanges) this.checkUpdateMask();
    const index = this.getEntityIndex(entityId);
    DEBUG: if (index === undefined) throw new InternalError('Entity backref not tracked');
    const empty = this.removeTag(index, this.makeTag(typeId, fieldSeq, internalIndex));
    if (empty) this.removeEntity(index, entityId, trackChanges);
  }

  private getEntityIndex(entityId: EntityId): number | undefined {
    if (this.entityIndex) return this.entityIndex[entityId];
    const k = this.entities.findIndex(entity => entity.__id === entityId);
    if (k >= 0) return k;
  }

  private indexEntities(): void {
    DEBUG: if (this.entityIndex) throw new InternalError('Entities already indexed');
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
      DEBUG: if (set === tag) throw new InternalError(`Ref ${tag} already tracked (single)`);
      this.tags[index] = [set, tag];
    } else if (Array.isArray(set)) {
      DEBUG: if (set.includes(tag)) throw new InternalError(`Ref ${tag} already tracked (array)`);
      if (set.length >= 1000) {
        const actualSet = this.tags[index] = new Set(set);
        actualSet.add(tag);
      } else {
        set.push(tag);
      }
    } else {
      DEBUG: if (set.has(tag)) throw new InternalError(`Ref ${tag} already tracked (set)`);
      set.add(tag);
    }
  }

  private removeTag(index: number, tag: number): boolean {
    if (!this.tags) return true;  // precise mode
    const set = this.tags[index];
    DEBUG: if (set === undefined) throw new InternalError(`Ref ${tag} not tracked (none)`);
    if (typeof set === 'number') {
      DEBUG: if (set !== tag) throw new InternalError(`Ref ${tag} not tracked (single ${set})`);
      delete this.tags[index];
      return true;
    }
    if (Array.isArray(set)) {
      const k = set.indexOf(tag);
      DEBUG: if (k === -1) throw new InternalError(`Ref ${tag} not tracked (array ${set})`);
      set.splice(k, 1);
      return !this.tags.length;
    }
    DEBUG: if (!set.has(tag)) {
      throw new InternalError(`Ref ${tag} not tracked (set ${new Array(...set)})`);
    }
    set.delete(tag);
    return !set.size;
  }

  private makeTag(typeId: number, fieldSeq: number, internalIndex: number | undefined): number {
    return typeId | (fieldSeq << COMPONENT_ID_BITS) |
      (internalIndex === undefined ? 0 : (internalIndex << (COMPONENT_ID_BITS + FIELD_SEQ_BITS)));
  }

  private addEntity(entityId: EntityId, trackChanges: boolean): number {
    const index = this.entities.length;
    this.entities.push(this.registry.pool.borrow(entityId));
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
    if (this.entityIndex) delete this.entityIndex[entityId];
    if (this.entities.length > index) {
      this.entities[index] = lastEntity!;
      if (this.entityIndex) this.entityIndex[lastEntity!.__id] = index;
    }
    if (this.tags) {
      const lastTag = this.tags.pop();
      if (this.tags.length > index) this.tags[index] = lastTag!;
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

  private checkUpdateMask(): void {
    const system = this.registry.executingSystem;
    for (const targetType of this.selector.targetTypes) {
      if (this.registry.hasShape(this.targetEntityId, targetType, this.trackStale)) {
        checkMask(targetType, system, 'update');
      }
    }
  }
}


export class RefIndexer {
  private refLog?: Log;
  private refLogPointer?: LogPointer;
  private refLogStatsPointer?: LogPointer;
  private readonly selectorIdsBySourceKey = new Map<number, number>();
  private readonly selectors: Selector[] = [];
  private readonly trackers = new Map<number, Tracker>();
  private readonly registry: Registry;

  constructor(
    private readonly dispatcher: Dispatcher,
    private readonly maxRefChangesPerFrame: number
  ) {
    this.registry = dispatcher.registry;
  }

  completeCycle(): void {
    this.flush();  // to handle ref changes coming from registry.processEndOfFrame()
    STATS: this.dispatcher.stats.maxRefChangesPerFrame =
      this.refLog?.countSince(this.refLogStatsPointer!) ?? 0;
  }

  registerSelector(
    targetType?: ComponentType<any>, sourceType?: ComponentType<any>, sourceFieldSeq?: number,
    trackStale = false
  ): number {
    CHECK: if (targetType) checkTypeDefined(targetType);
    CHECK: if (sourceType) checkTypeDefined(sourceType);
    if (!this.refLog) {
      this.refLog = new Log(
        this.maxRefChangesPerFrame, 'maxRefChangesPerFrame', this.dispatcher.buffers,
        {localProcessingAllowed: true}
      );
      this.refLogPointer = this.refLog.createPointer();
      this.refLogStatsPointer = this.refLog.createPointer();
    }
    const selectorSourceKey = sourceType ?
      (sourceFieldSeq === undefined ?
        -2 - sourceType.id! : sourceType.id! | (sourceFieldSeq << COMPONENT_ID_BITS)
      ) : -1;
    let selectorId = this.selectorIdsBySourceKey.get(selectorSourceKey);
    if (selectorId === undefined) {
      // Always track stale refs on the global selector.
      if (!this.selectors.length) trackStale = true;
      const selector = {
        id: this.selectors.length, targetTypes: targetType ? [targetType] : [], sourceType,
        matchType: !!sourceType, matchSeq: sourceFieldSeq !== undefined,
        sourceTypeId: sourceType?.id, sourceSeq: sourceFieldSeq, trackStale
      };
      this.selectors.push(selector);
      selectorId = selector.id;
      this.selectorIdsBySourceKey.set(selectorSourceKey, selectorId);
      CHECK: if (selectorId > MAX_NUM_COMPONENTS) {
        throw new CheckError(`Too many distinct backrefs selectors`);
      }
    } else {
      const selector = this.selectors[selectorId];
      selector.trackStale = selector.trackStale || trackStale;
      if (targetType) selector.targetTypes.push(targetType);
    }
    return selectorId;
  }

  getBackrefs(entityId: EntityId, selectorId = 0): Entity[] {
    const selector = this.selectors[selectorId];
    return this.getOrCreateTracker(
      selector, entityId, this.registry.includeRecentlyDeleted).entities;
  }

  trackRefChange(
    sourceId: EntityId, sourceType: ComponentType<any>, sourceSeq: number,
    sourceInternalIndex: number | undefined, oldTargetId: EntityId, newTargetId: EntityId,
    unreference: boolean, release: boolean
  ): void {
    DEBUG: if (!this.refLog) throw new InternalError(`Trying to trackRefChange without a refLog`);
    DEBUG: if (oldTargetId === newTargetId && unreference) {
      throw new InternalError('No-op call to trackRefChange');
    }
    if (oldTargetId !== -1) {
      const action = (unreference ? Action.UNREFERENCE : 0) | (release ? Action.RELEASE : 0);
      DEBUG: if (!action) {
        throw new InternalError('Called trackRefChange with neither unreference nor release');
      }
      this.pushRefLogEntry(
        sourceId, sourceType, sourceSeq, sourceInternalIndex, oldTargetId, action
      );
    }
    if (newTargetId !== -1) {
      this.pushRefLogEntry(
        sourceId, sourceType, sourceSeq, sourceInternalIndex, newTargetId, Action.REFERENCE
      );
    }
  }

  clearAllRefs(targetId: EntityId, final: boolean): void {
    if (!this.selectors.length) return;
    this.getTracker(this.selectors[0], targetId, final)?.clearAllRefs(final);
  }

  private pushRefLogEntry(
    sourceId: EntityId, sourceType: ComponentType<any>, sourceSeq: number,
    sourceInternalIndex: number | undefined, targetId: EntityId, action: Action,
  ): void {
    const internallyIndexed = typeof sourceInternalIndex !== 'undefined';
    DEBUG: {
      if (internallyIndexed && !sourceType.__binding!.fields[sourceSeq].type.internallyIndexed) {
        throw new InternalError('Inconsistent internally indexed flag');
      }
    }
    this.refLog!.push(sourceId | (sourceType.id! << ENTITY_ID_BITS));
    this.refLog!.push(
      targetId | (sourceSeq << ENTITY_ID_BITS) | action | (internallyIndexed ? 2 ** 29 : 0));
    if (internallyIndexed) this.refLog!.push(sourceInternalIndex!);
    this.processEntry(
      sourceId, sourceType.id!, sourceSeq, sourceInternalIndex, targetId, action, true
    );
  }

  private getOrCreateTracker(selector: Selector, targetId: EntityId, stale: boolean): Tracker {
    let tracker = this.getTracker(selector, targetId, stale);
    if (tracker) return tracker;
    DEBUG: if (stale && !selector.trackStale) {
      throw new InternalError('Selector not configured for stale tracking');
    }
    let staleTracker: Tracker;
    tracker = new Tracker(targetId, selector, false, this.dispatcher);
    this.trackers.set(targetId | (selector.id << ENTITY_ID_BITS), tracker);
    if (selector.trackStale) {
      staleTracker = new Tracker(targetId, selector, true, this.dispatcher);
      this.trackers.set(targetId | (selector.id << ENTITY_ID_BITS) | 2 ** 31, staleTracker);
    }
    return stale ? staleTracker! : tracker;
  }

  private getTracker(selector: Selector, targetId: EntityId, stale: boolean): Tracker | undefined {
    return this.trackers.get(targetId | (selector.id << ENTITY_ID_BITS) | (stale ? 2 ** 31 : 0));
  }

  flush(): void {
    if (!this.refLog) return;
    while (true) {
      const [log, startIndex, endIndex, local] =
        this.refLog.processAndCommitSince(this.refLogPointer!);
      if (!log) break;
      if (local) continue;
      for (let i = startIndex!; i < endIndex!; i += 2) {
        const entryPart1 = log[i], entryPart2 = log[i + 1];
        const sourceId = (entryPart1 & ENTITY_ID_MASK) as EntityId;
        const sourceTypeId = entryPart1 >>> ENTITY_ID_BITS;
        const targetId = (entryPart2 & ENTITY_ID_MASK) as EntityId;
        const sourceSeq = (entryPart2 >>> ENTITY_ID_BITS) & (MAX_NUM_FIELDS - 1);
        const action: Action = entryPart2 & ACTION_MASK;
        const internallyIndexed = (entryPart2 & 2 ** 29) !== 0;
        const internalIndex = internallyIndexed ? log[i + 2] : undefined;
        if (internallyIndexed) i += 1;
        this.processEntry(
          sourceId, sourceTypeId, sourceSeq, internalIndex, targetId, action, false
        );
      }
    }
  }

  private processEntry(
    sourceId: EntityId, sourceTypeId: number, sourceSeq: number,
    sourceInternalIndex: number | undefined, targetId: EntityId, action: Action, local: boolean
  ): void {
    for (let j = 0; j < this.selectors.length; j++) {
      const selector = this.selectors[j];
      if ((!selector.matchType || selector.sourceTypeId === sourceTypeId) &&
          (!selector.matchSeq || selector.sourceSeq === sourceSeq)) {
        if (action === Action.REFERENCE || action & Action.UNREFERENCE) {
          const tracker = this.getOrCreateTracker(selector, targetId, false);
          if (action === Action.REFERENCE) {
            tracker.trackReference(sourceId, sourceTypeId, sourceSeq, sourceInternalIndex, local);
          } else {
            tracker.trackUnreference(sourceId, sourceTypeId, sourceSeq, sourceInternalIndex, local);
          }
        }
        if (selector.trackStale && (action === Action.REFERENCE || action & Action.RELEASE)) {
          const tracker = this.getOrCreateTracker(selector, targetId, true);
          if (action === Action.REFERENCE) {
            tracker.trackReference(sourceId, sourceTypeId, sourceSeq, sourceInternalIndex, local);
          } else {
            tracker.trackUnreference(sourceId, sourceTypeId, sourceSeq, sourceInternalIndex, local);
          }
        }
      }
    }
  }
}
