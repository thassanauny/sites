import type { CSSProperties } from "react";
import { colorDepth } from "../domain/boards/appearance";
import type { ColorIntensity, Tone } from "../domain/boards/types";

const palettes: Record<Tone, { ink: string; badge: string; deep: string; fill: string; note: string; noteBorder: string }> = {
  green: { ink: "#388266", badge: "#edf6ef", deep: "#1d6b50", fill: "#deeee4", note: "#edf5e7", noteBorder: "#d9e7ce" },
  blue: { ink: "#5a80a3", badge: "#edf3f9", deep: "#315f91", fill: "#dce9f8", note: "#edf3fb", noteBorder: "#d4e2f3" },
  purple: { ink: "#9376ae", badge: "#f3eef8", deep: "#6f4994", fill: "#e9def4", note: "#f4edf9", noteBorder: "#e4d5ee" },
  orange: { ink: "#bc9153", badge: "#fcf5e9", deep: "#925b17", fill: "#f6e6cc", note: "#fdf7df", noteBorder: "#f0e6bd" },
  rose: { ink: "#b97e8e", badge: "#faf0f3", deep: "#98475f", fill: "#f4dce4", note: "#fbedef", noteBorder: "#efd2db" },
  slate: { ink: "#7a8b88", badge: "#f0f4f2", deep: "#465f5b", fill: "#e1eae7", note: "#f0f3ef", noteBorder: "#dae3d8" },
};

function channels(hex: string) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

function mix(soft: string, deep: string, fraction: number) {
  const target = channels(deep);
  return "#" + channels(soft).map((channel, index) =>
    Math.round(channel + (target[index] - channel) * fraction).toString(16).padStart(2, "0")
  ).join("");
}

function luminance(hex: string) {
  const linear = channels(hex).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function diagramAppearance(intensity?: ColorIntensity) {
  const fraction = colorDepth(intensity) / 100;
  const connectionWidth = 1.6 + fraction * 0.9;
  const variables: Record<string, string | number> = {
    "--diagram-border-width": `${1 + fraction * 0.6}px`,
    "--diagram-boundary-width": `${2 + fraction * 0.8}px`,
    "--diagram-connection-width": `${connectionWidth}px`,
    "--diagram-handle-border": mix("#b9c9bd", "#2c5848", fraction),
  };
  for (const [tone, palette] of Object.entries(palettes)) {
    const badge = mix(palette.badge, palette.deep, fraction);
    const darkInk = mix(palette.ink, "#183a2c", Math.min(1, fraction * 3));
    const backgroundLuminance = luminance(badge);
    const whiteContrast = 1.05 / (backgroundLuminance + 0.05);
    const darkContrast = (backgroundLuminance + 0.05) / (luminance(darkInk) + 0.05);
    const workflowFill = mix(palette.note, palette.deep, fraction);
    const workflowWhiteContrast = 1.05 / (luminance(workflowFill) + 0.05);
    const workflowDarkContrast = (luminance(workflowFill) + 0.05) / (luminance("#183a2c") + 0.05);
    const values = {
      "workflow-fill": workflowFill,
      "workflow-ink": workflowWhiteContrast > workflowDarkContrast ? "#ffffff" : "#183a2c",
      fill: mix("#ffffff", palette.fill, fraction),
      border: mix("#dfe7e1", palette.deep, fraction),
      badge,
      ink: whiteContrast > darkContrast ? "#ffffff" : darkInk,
      annotation: mix(palette.ink, palette.deep, fraction),
      "note-fill": mix(palette.note, palette.fill, fraction),
      "note-border": mix(palette.noteBorder, palette.deep, fraction),
      "boundary-fill": palette.deep + Math.round((0.02 + fraction * 0.04) * 255).toString(16).padStart(2, "0"),
      "boundary-border": mix(palette.noteBorder, palette.deep, 0.35 + fraction * 0.65),
      "boundary-label": mix(palette.ink, palette.deep, fraction),
    };
    for (const [name, value] of Object.entries(values)) variables[`--depth-${tone}-${name}`] = value;
  }
  return {
    variables: variables as CSSProperties,
    connection: {
      color: mix("#8c9b96", "#2c5848", fraction),
      width: connectionWidth,
      labelColor: mix("#6d7a75", "#234335", fraction),
    },
  };
}
