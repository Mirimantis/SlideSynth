// Action types for future undo/redo support.
// Currently mutations go through store.mutate() directly.
// This file will hold action creators when we implement undo/redo in Phase 7.

export type ActionType =
  | 'ADD_POINT'
  | 'MOVE_POINT'
  | 'DELETE_POINT'
  | 'ADD_CURVE'
  | 'DELETE_CURVE'
  | 'ADD_TRACK'
  | 'DELETE_TRACK'
  | 'SET_HANDLE'
  | 'SET_POINT_VOLUME';

export interface Action {
  type: ActionType;
  payload: unknown;
}
