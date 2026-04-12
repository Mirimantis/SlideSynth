# Session Notes — hopeful-germain worktree

## Features Implemented

### 1. Undo/Redo System
- **File:** `src/state/history.ts` (new)
- Snapshot-based undo using `JSON.parse(JSON.stringify())` deep cloning
- Max 50 undo steps, redo stack cleared on new edits
- Drag batching: snapshot taken on `mousedown`, not on `mousemove`, so entire drag = 1 undo step
- Keyboard shortcuts: Ctrl+Z (undo), Ctrl+Shift+Z / Ctrl+Y (redo)
- Toolbar buttons (Undo/Redo) with auto-disable when stack is empty
- `clearInteractionForUndo()` helper clears stale drawing/transform state on undo
- Snapshot calls added before all mutations: BPM, length, track mute/solo, tone changes, curve draw/delete, point drag, transform drag, slider drags (mousedown), file load
- Removed unused `src/state/actions.ts` placeholder

### 2. Extended Octave Range (C0-C9)
- **File:** `src/constants.ts`
- Changed MIN_NOTE from 36 (C2) to 12 (C0), MAX_NOTE from 96 (C7) to 120 (C9)
- 9 octaves (108 chromatic note lines) instead of 5

### 3. Single-Click Transform Mode
- **File:** `src/canvas/interaction.ts`
- Transform box activates on single-click of a curve segment (was double-click)
- More intuitive: click a curve to select and transform it immediately

### 4. Snap Toggle (S key + UI button)
- **Files:** `src/canvas/interaction.ts`, `src/main.ts`, `src/ui/toolbar.ts`
- Removed Shift-hold-to-disable-snap behavior
- Added 's' key toggle (press to toggle snap on/off)
- Added Snap button in toolbar (toggles active/inactive state)
- `updateSnap()` method added to toolbar return type

### 5. Multi-Curve Selection
- **Files:** `src/types.ts`, `src/state/store.ts`, `src/model/curve.ts`, `src/canvas/curve-renderer.ts`, `src/canvas/interaction.ts`, `src/main.ts`, `src/ui/property-panel.ts`

#### Data model changes:
- `AppState.selectedCurveId: string | null` → `selectedCurveIds: Set<string>`
- `TransformBoxState` changed from single-curve (`curveId`, `originalPoints`) to multi-curve (`curveIds: string[]`, `originalPointsMap: Map<string, ControlPoint[]>`)
- Added `computeMultiCurveBBox()` for union bounding box across multiple curves

#### Store changes:
- New methods: `setSelectedCurve()`, `setSelectedCurves()`, `addSelectedCurve()`, `toggleSelectedCurve()`
- Convenience getter: `getSelectedCurveId()` returns single ID when exactly 1 selected, else null

#### Rendering:
- `renderCurves()` takes `selectedCurveIds: ReadonlySet<string>`, `selectedPointCurveId`, `selectedPointIndex`
- Three visual tiers: handles visible (single-curve point editing), thick stroke (selected, no handles), faint (unselected)
- Transform box renders behind curves so unselected curves remain visible and clickable

#### Interaction:
- **Shift+click** (Select tool): toggles curves in/out of selection
- Transform box encompasses all selected curves; resize/translate/octave-shift applies to all
- Clicking a track in the track list selects all its curves, builds a transform box, switches to Select tool
- `findCurveAt()` helper: hit-tests curves under cursor
- Translate hit inside transform box checks for unselected curves first — lets you select them instead of starting a translate drag
- Shift+click inside transform box toggles the hit curve in/out of selection
- Delete/Backspace deletes all selected curves (when no point is selected)
- Handle hit-testing restricted to single-curve mode (multi-select doesn't show handles)
- `rebuildTransformBox()` helper rebuilds transform box from current `selectedCurveIds`

#### Property panel:
- Uses `store.getSelectedCurveId()` for backward-compatible single-curve display

## Bug Fixes Applied During Development
- **Transform box left behind after undo:** Added `clearInteractionForUndo()` to clear `interaction.transformBox`
- **Ctrl+Z switched to draw mode:** Added `ctrlSwitchedTool` flag; keyup only reverts tool if Ctrl actually triggered the switch
- **BPM undo didn't update toolbar:** Added `updateBpm()` to toolbar and called from store subscription
- **Ghost draw preview after undo:** Added defensive check in render loop validating `drawingCurve` still exists in composition
- **MIDI load couldn't be undone:** Changed from `history.clear()` to `history.snapshot()` before load

## Files Modified (from main)
- `src/types.ts` — selectedCurveIds Set, TransformBoxState multi-curve
- `src/state/store.ts` — multi-curve selection methods
- `src/state/history.ts` — NEW: undo/redo system
- `src/model/curve.ts` — computeMultiCurveBBox, deepCopyPoints
- `src/canvas/curve-renderer.ts` — multi-select rendering tiers
- `src/canvas/interaction.ts` — multi-curve transform, Shift+click, findCurveAt
- `src/canvas/transform-box-renderer.ts` — (existed, no changes needed)
- `src/main.ts` — undo/redo UI, multi-select render loop, track click select-all
- `src/ui/toolbar.ts` — snap toggle button, updateSnap/updateBpm
- `src/ui/property-panel.ts` — getSelectedCurveId() compat
- `src/constants.ts` — extended octave range
- `DESIGN.md` — updated for all new features
