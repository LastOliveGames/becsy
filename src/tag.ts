import type {Component} from './component';
import type {EntityId} from './entity';
import {Pool} from './pool';
import type {System} from './system';


export class Tag {
  entityId: EntityId;
  offset: number;
  mutable: boolean;
  system?: System;
}


export const tagPool = new Pool(Tag);
export const tagMap = new Map<Component, Tag>();

