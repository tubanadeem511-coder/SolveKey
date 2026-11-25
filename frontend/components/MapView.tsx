"use client";

import dynamic from "next/dynamic";
import type { MapCanvasProps } from "./MapCanvas";

const DynamicMapCanvas = dynamic(
  () => import("./MapCanvas").then((module) => module.MapCanvas),
  {
    ssr: false,
    loading: () => <div className="grid h-full place-items-center text-sm text-slate-500">Loading map…</div>,
  },
);

export function MapView(props: MapCanvasProps) {
  return <DynamicMapCanvas {...props} />;
}
