import type { ReactNode } from "react";
import type { ComponentKind, FlowComponentKind } from "../domain/boards/types";

const soft = { fill: "currentColor", fillOpacity: 0.08 };
const solid = { fill: "currentColor", stroke: "none" };

export const classicIcons: Record<Exclude<ComponentKind, FlowComponentKind>, ReactNode> = {
  client: (
    <>
      <rect x="4" y="6" width="32" height="24" rx="2" />
      <path d="M4 25h32M20 30v8m-8 0h16" />
      <rect x="32" y="20" width="12" height="22" rx="2" {...soft} />
      <path d="M36 37h4" />
    </>
  ),
  gateway: (
    <>
      <path d="M3 24h10m-4-4 4 4-4 4m26-4h10m-4-4 4 4-4 4" />
      <rect x="13" y="7" width="22" height="34" rx="2" {...soft} />
      <path d="M19 13h10m-10 22h10m-10-15-3 4 3 4m10-8 3 4-3 4m-5-9-2 18" />
    </>
  ),
  service: (
    <>
      <rect x="9" y="3" width="30" height="42" rx="2" {...soft} />
      <path d="M9 17h30M9 31h30m-19-20h12m-12 14h12m-12 14h12" />
      <g {...solid}>
        <circle cx="15" cy="10" r="1.5" />
        <circle cx="15" cy="24" r="1.5" />
        <circle cx="15" cy="38" r="1.5" />
      </g>
    </>
  ),
  balancer: (
    <>
      <circle cx="24" cy="24" r="13" {...soft} />
      <path d="M2 24h13m-4-4 4 4-4 4m13 0V7h17m-5-5 5 5-5 5M24 24h20m-5-5 5 5-5 5M24 24v17h17m-5-5 5 5-5 5" />
    </>
  ),
  cdn: (
    <>
      <circle cx="24" cy="24" r="13" />
      <ellipse cx="24" cy="24" rx="5" ry="13" />
      <path d="M11 24h26M6 7l8 8m20 19 8 7m-8-26 8-8M6 41l8-7" />
      <g {...soft}>
        <circle cx="5" cy="6" r="3" /><circle cx="43" cy="6" r="3" />
        <circle cx="5" cy="42" r="3" /><circle cx="43" cy="42" r="3" />
      </g>
    </>
  ),
  function: (
    <>
      <path d="M9 7H5v13L2 24l3 4v13h4m30-34h4v13l3 4-3 4v13h-4" />
      <path d="M15 10h8l13 29m-13-10-6 10h-6" strokeWidth="3.2" />
    </>
  ),
  database: (
    <>
      <path d="M7 10v28c0 8 34 8 34 0V10" {...soft} />
      <ellipse cx="24" cy="10" rx="17" ry="6" />
      <path d="M7 38c0 8 34 8 34 0" />
    </>
  ),
  cache: (
    <>
      <path d="M14 3v7m10-7v7m10-7v7M14 38v7m10-7v7m10-7v7M3 14h7m-7 10h7m-7 10h7m28-20h7m-7 10h7m-7 10h7" />
      <rect x="10" y="10" width="28" height="28" rx="2" {...soft} />
      <path d="m26 14-10 13h8l-2 9 11-15h-8Z" {...solid} />
    </>
  ),
  queue: (
    <>
      <path d="M5 12v24m38-24v24M5 15h38M5 33h38M1 24h7m32 0h7m-5-5 5 5-5 5" />
      <g {...soft}>
        <rect x="10" y="19" width="6" height="10" />
        <rect x="21" y="19" width="6" height="10" />
        <rect x="32" y="19" width="6" height="10" />
      </g>
    </>
  ),
  storage: (
    <>
      <path d="m8 10 4 29c1 7 23 7 24 0l4-29" {...soft} />
      <ellipse cx="24" cy="10" rx="16" ry="6" />
      <path d="M16 25h16m-14 6h12" />
    </>
  ),
  external: (
    <>
      <path d="M34 37H12a10 10 0 0 1-1-20 13 13 0 0 1 24-5 13 13 0 0 1-1 25Z" />
      <path d="M17 25h16m-6-6 6 6-6 6" />
    </>
  ),
  note: (
    <>
      <path d="M9 4h22l9 9v31H9Zm22 0v9h9" {...soft} />
      <path d="M16 22h17m-17 8h17m-17 8h10" />
    </>
  ),
  text: <path d="M8 14V7h32v7M24 7v34m-9 0h18" />,
  boundary: <rect x="5" y="5" width="38" height="38" rx="2" strokeDasharray="5 4" />,
};

export const architectureIcons: Record<Exclude<ComponentKind, FlowComponentKind>, ReactNode> = {
  client: (
    <>
      <circle cx="12" cy="12" r="5" />
      <path d="M3 32v-5a9 9 0 0 1 18 0v5H3Zm24-21h17v20H27ZM27 17h17M27 25h-8m2-4 4 4-4 4" />
    </>
  ),
  gateway: <path d="M17 7h14l8 17-8 17H17L9 24Zm2 9v16m10-16v16M2 24h14m-5-5 5 5-5 5m21-5h14m-5-5 5 5-5 5" />,
  service: (
    <>
      <path d="m24 9 13 8v14l-13 8-13-8V17Zm-13 8 13 8 13-8m-13 8v14M24 2v7m0 30v7M4 13l7 4m26 14 7 4M4 35l7-4m26-14 7-4" />
      <circle cx="24" cy="25" r="3" {...solid} />
    </>
  ),
  balancer: <path d="m12 10 21 14-21 14ZM2 24h10m9-8 12-8h10M21 32l12 8h10m-10-16h10m-5-21 5 5-5 5m0 6 5 5-5 5m0 6 5 5-5 5" />,
  cdn: (
    <>
      <path d="M12 11h24M10 15v18m28-18v18M12 37h24M14 13l8 8m12-8-8 8m-12 14 8-8m12 8-8-8" />
      <circle cx="9" cy="10" r="6" /><circle cx="39" cy="10" r="6" />
      <circle cx="9" cy="38" r="6" /><circle cx="39" cy="38" r="6" />
      <rect x="19" y="19" width="10" height="10" {...solid} />
    </>
  ),
  function: <path d="M11 5C2 14 2 34 11 43m26-38c9 9 9 29 0 38M15 9h9l13 30m-13-9-6 9h-6" strokeWidth="4" />,
  database: (
    <>
      <path d="M5 7h38v34H5ZM5 17h38M5 25h38M5 33h38M18 17v24m12-24v24" />
      <path d="M5 7h38v10H5Z" {...solid} />
    </>
  ),
  cache: <path d="M9 11h30v26H9ZM4 16h5m-5 8h5m-5 8h5m30-16h5m-5 8h5m-5 8h5M14 17h5v5h-5Zm11 0h8v5h-8ZM14 28h19M18 5l6-3 6 3m-6-3v9" />,
  queue: (
    <>
      <path d="M4 11v26m40-26v26M4 17h40M4 31h40m-6-24 6 4-6 4" />
      <path d="M10 20h6v8h-6Zm11 0h6v8h-6Zm11 0h6v8h-6Z" {...solid} />
    </>
  ),
  storage: <path d="m5 14 19-9 19 9-19 9Zm0 0v22l19 9 19-9V14M24 23v22m-10-35 19 9v8m-22 5 7 3" />,
  external: (
    <>
      <path d="M26 4v40" strokeDasharray="3 5" />
      <path d="M6 20h14v8H6Zm2 0v-7m10 7v-7m-5 15v8h7m12-12h12m-5-5 5 5-5 5" />
      <circle cx="32" cy="24" r="3" {...solid} />
    </>
  ),
  note: classicIcons.note,
  text: classicIcons.text,
  boundary: classicIcons.boundary,
};
