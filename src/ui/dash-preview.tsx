import { useEffect, useRef } from 'preact/hooks';

/** A tone's line style, drawn as a short stroke in its colour. */
export function DashPreview({ color, pattern, width, height, class: cls, id }: {
  color: string;
  pattern: readonly number[];
  width: number;
  height: number;
  class?: string;
  id?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([...pattern]);
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
  }, [color, pattern.join(','), width, height]);
  return <canvas ref={ref} id={id} class={cls} width={width} height={height} />;
}
