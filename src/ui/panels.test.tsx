import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { store } from '../state/store';
import { createComposition } from '../model/composition';
import { createTrack } from '../model/track';
import { createLane, createLanePoint } from '../model/lane';
import type { BezierCurve } from '../types';
import { PropertyPanel } from './property-panel';
import { ToolPropertyPanel } from './tool-property-panel';
import { TrackList, type TrackListActions } from './track-list';

function curve(id: string): BezierCurve {
  const lane = createLane('pitch');
  lane.points = [createLanePoint(0, 6000), createLanePoint(2, 6150)];
  return { id, lanes: [lane] };
}

const noActions = new Proxy({}, { get: () => () => {} }) as TrackListActions;

/** Two tracks; "Lead" (selected) has curve c1, "Bass" is muted. */
function seed() {
  const comp = createComposition();
  const toneId = comp.toneLibrary[0]!.id;
  const lead = createTrack('Lead', toneId);
  lead.curves = [curve('c1')];
  lead.volume = 0.5;
  const bass = createTrack('Bass <b>', toneId);
  bass.muted = true;
  comp.tracks = [lead, bass];
  comp.guides = [{ id: 'g1', orientation: 'y', position: 6000, label: 'tonic' } as never];
  store.loadComposition(comp);
  store.setSelectedTrack(lead.id);
  return { lead, bass };
}

describe('Preact panels (BACKLOG 15.4)', () => {
  beforeEach(() => { seed(); });

  it('Object Properties shows the active track, with its volume', () => {
    const html = renderToString(<PropertyPanel />);
    expect(html).toContain('Lead');
    expect(html).toContain('0.50');
    expect(html).not.toContain('Move to track');
  });

  it('offers Move to track for a single selected curve, listing the other tracks', () => {
    store.setSelectedCurves(['c1']);
    const html = renderToString(<PropertyPanel />);
    expect(html).toContain('Move to track');
    expect(html).toContain('Bass &lt;b>');
    expect(html).toContain('+ New track');
  });

  it('shows the selected point, and the selected guide over everything else', () => {
    store.setSelectedCurve('c1');
    store.setSelectedPoint(1);
    expect(renderToString(<PropertyPanel />)).toContain('Point 2 of 2');

    store.setSelectedGuide('g1');
    const guide = renderToString(<PropertyPanel />);
    expect(guide).toContain('Snap Guide');
    expect(guide).toContain('tonic');
    expect(guide).toContain('Delete Guide');
  });

  it('Tool Properties follows the active tool', () => {
    store.setTool('draw');
    expect(renderToString(<ToolPropertyPanel />)).toContain('Draw Preview');
    store.setTool('select');
    expect(renderToString(<ToolPropertyPanel />)).toContain('No settings for this tool');
    store.setTool('draw');
  });

  it('the track list marks the selected and muted rows, and escapes names', () => {
    const html = renderToString(<TrackList actions={noActions} />);
    expect(html.match(/class="track-item/g)).toHaveLength(2);
    expect(html).toMatch(/class="track-item selected"[^>]*>.*Lead/);
    expect(html).toContain('class="track-item muted"');
    expect(html).toContain('Bass &lt;b>');
  });
});
