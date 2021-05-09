
export const ENTITY_ID_BITS = 22;
export const COMPONENT_ID_BITS = 9;
export const FIELD_SEQ_BITS = 7;

export const MAX_NUM_ENTITIES = 2 ** ENTITY_ID_BITS;
export const ENTITY_ID_MASK = MAX_NUM_ENTITIES - 1;
export const MAX_NUM_COMPONENTS = 2 ** COMPONENT_ID_BITS;
export const COMPONENT_ID_MASK = MAX_NUM_COMPONENTS - 1;
export const MAX_NUM_FIELDS = 2 ** FIELD_SEQ_BITS;
export const FIELD_SEQ_MASK = MAX_NUM_FIELDS - 1;

// TODO: enforce max length of ref structs/arrays
