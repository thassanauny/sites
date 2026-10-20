import { useContext, type ReactNode } from "react";
import { componentIconSets, type ComponentIconStyle, type ComponentKind, type FlowComponentKind } from "../domain/boards/types";
import { isFlowKind } from "../domain/boards/components";
import { flowIcons } from "./flowIcons";
import { architectureIcons, classicIcons } from "./systemDesignIcons";
import { IconStyleContext } from "./IconStyleContext";

const softFill = { fill: "currentColor", fillOpacity: 0.14 };
const duotoneIcons: Record<Exclude<ComponentKind, FlowComponentKind>, ReactNode> = {
  client: (
    <>
      <rect x="3" y="5" width="26" height="22" rx="4" {...softFill} />
      <path d="M3 12h26" />
      <g fill="currentColor" stroke="none">
        <circle cx="7" cy="8.5" r="1" />
        <circle cx="10.5" cy="8.5" r="1" />
      </g>
      <path d="m12 17-3 3 3 3m8-6 3 3-3 3" strokeOpacity=".55" />
    </>
  ),
  gateway: (
    <>
      <path d="M2 16h7m14-7h7m-7 14h7" strokeOpacity=".55" />
      <path d="m5 13 3 3-3 3m21-13 3 3-3 3m0 8 3 3-3 3" />
      <path d="m16 3 7 4v18l-7 4-7-4V7Z" {...softFill} />
      <path d="M13 12v8m6-8v8" />
    </>
  ),
  service: (
    <>
      <rect x="5" y="3" width="22" height="10" rx="3" {...softFill} />
      <rect x="5" y="19" width="22" height="10" rx="3" {...softFill} />
      <g fill="currentColor" stroke="none">
        <circle cx="10" cy="8" r="1.5" />
        <circle cx="10" cy="24" r="1.5" />
      </g>
      <path d="M16 8h6m-6 16h6M16 13v6" strokeOpacity=".55" />
    </>
  ),
  balancer: (
    <>
      <path d="M5 16h9V7h9m-9 9h9m-9 0v9h9" strokeOpacity=".55" />
      <path d="m21 4 3 3-3 3m0 3 3 3-3 3m0 3 3 3-3 3" />
      <rect x="2" y="12" width="8" height="8" rx="2" {...softFill} />
    </>
  ),
  database: (
    <>
      <path d="M5 7c0-6 22-6 22 0v18c0 6-22 6-22 0Z" {...softFill} />
      <ellipse cx="16" cy="7" rx="11" ry="4" />
      <path d="M5 15c0 6 22 6 22 0m-22 7c0 6 22 6 22 0" strokeOpacity=".55" />
    </>
  ),
  cache: (
    <>
      <rect x="5" y="5" width="22" height="22" rx="5" {...softFill} />
      <path d="M11 2v3m10-3v3M11 27v3m10-3v3M2 11h3m-3 10h3m22-10h3m-3 10h3" strokeOpacity=".55" />
      <path d="m18 8-8 10h6l-2 7 9-11h-6Z" fill="currentColor" stroke="none" />
    </>
  ),
  queue: (
    <>
      <path d="M5 7.5v17m22-17v17M5 9.5h22M5 22.5h22" strokeOpacity=".55" />
      <path d="M1 16h2m26 0h2m-2.5-2.5L31 16l-2.5 2.5" />
      <rect x="7.5" y="12" width="4.5" height="8" rx="1" {...softFill} />
      <rect x="14" y="12" width="4.5" height="8" rx="1" {...softFill} />
      <rect x="20.5" y="12" width="4.5" height="8" rx="1" {...softFill} />
    </>
  ),
  storage: (
    <>
      <path d="m5 8 2 18c.3 4 17.7 4 18 0l2-18Z" {...softFill} />
      <ellipse cx="16" cy="8" rx="11" ry="4" />
      <path d="m12 16 4-2 4 2v6l-4 2-4-2Zm0 0 4 2 4-2m-4 2v6" strokeOpacity=".55" />
    </>
  ),
  cdn: (
    <>
      <circle cx="16" cy="16" r="12" {...softFill} />
      <ellipse cx="16" cy="16" rx="5" ry="12" strokeOpacity=".55" />
      <path d="M4 16h24" strokeOpacity=".55" />
      <g fill="currentColor" stroke="none">
        <circle cx="5.5" cy="10" r="2.5" />
        <circle cx="26.5" cy="22" r="2.5" />
        <circle cx="16" cy="4" r="2.5" />
      </g>
    </>
  ),
  function: (
    <>
      <rect x="3" y="3" width="26" height="26" rx="5" {...softFill} stroke="none" />
      <path d="M11 7H9v6l-3 3 3 3v6h2m10-18h2v6l3 3-3 3v6h-2" />
      <path d="m17 9-5 9h4l-1 6 6-10h-5Z" fill="currentColor" stroke="none" />
    </>
  ),
  external: (
    <>
      <path d="M24 25H9a6 6 0 0 1-.7-12A8 8 0 0 1 23 10a7.5 7.5 0 0 1 1 15Z" {...softFill} />
      <path d="M13 21 23 11m-7 0h7v7" />
    </>
  ),
  note: (
    <>
      <path d="M6 3h14l7 7v17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" {...softFill} />
      <path d="M20 3v7h7m-17 7h11m-11 5h7" strokeOpacity=".55" />
    </>
  ),
  text: (
    <>
      <rect x="3" y="3" width="26" height="26" rx="5" {...softFill} stroke="none" />
      <path d="M8 11V8h16v3M16 8v17m-5 0h10" />
    </>
  ),
  boundary: (
    <>
      <rect x="3" y="3" width="26" height="26" rx="4" {...softFill} strokeDasharray="4 4" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <rect x="18" y="18" width="6" height="6" rx="1" />
      <path d="M15 12h6v6" strokeOpacity=".55" />
    </>
  ),
};

export function ComponentIcon({
  kind,
  size = 20,
  iconStyle,
  className,
}: {
  kind: ComponentKind;
  size?: number;
  iconStyle?: ComponentIconStyle;
  className?: string;
}) {
  const boardIconStyle = useContext(IconStyleContext);
  const selectedStyle = componentIconSets.find(({ id }) => id === (iconStyle ?? boardIconStyle))?.id ?? "duotone";
  const square = selectedStyle === "technical" || selectedStyle === "architecture";
  const systemSymbols = !isFlowKind(kind) && (selectedStyle === "classic" || selectedStyle === "architecture");
  const icons = selectedStyle === "classic" ? classicIcons : selectedStyle === "architecture" ? architectureIcons : duotoneIcons;
  return (
    <svg
      width={size}
      height={size}
      viewBox={systemSymbols ? "0 0 48 48" : "0 0 32 32"}
      fill="none"
      stroke="currentColor"
      strokeWidth={selectedStyle === "classic" ? 2.5 : selectedStyle === "architecture" ? 2.8 : 2.2}
      strokeLinecap={square ? "square" : "round"}
      strokeLinejoin={square ? "miter" : "round"}
      aria-hidden="true"
      data-icon-style={selectedStyle}
      className={[`component-icon-${selectedStyle}`, className].filter(Boolean).join(" ")}
    >
      {isFlowKind(kind) ? flowIcons[kind] : icons[kind]}
    </svg>
  );
}
