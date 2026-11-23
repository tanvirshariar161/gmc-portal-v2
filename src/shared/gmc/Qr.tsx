import { useMemo } from "react";

/** Placeholder code pattern for the prototype; the real QR comes from the NDI verifier session. */
export function DemoQr({ seed, label = "Verification code", className = "size-52" }: { seed: string; label?: string; className?: string }) {
  const cells = useMemo(() => {
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return Array.from({ length: 25 * 25 }, () => {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      return (h >>> 0) % 3 === 0;
    });
  }, [seed]);
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width="7" height="7" fill="currentColor" />
      <rect x={x + 1} y={y + 1} width="5" height="5" fill="var(--surface)" />
      <rect x={x + 2} y={y + 2} width="3" height="3" fill="currentColor" />
    </g>
  );
  const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16);
  return (
    <svg role="img" aria-label={label} viewBox="-2 -2 29 29" className={`${className} text-fg`}>
      <rect x="-2" y="-2" width="29" height="29" fill="var(--surface)" />
      {cells.map((on, i) => {
        const x = i % 25;
        const y = Math.floor(i / 25);
        return on && !inFinder(x, y) ? <rect key={i} x={x} y={y} width="1" height="1" fill="currentColor" /> : null;
      })}
      {finder(0, 0)}
      {finder(18, 0)}
      {finder(0, 18)}
    </svg>
  );
}

