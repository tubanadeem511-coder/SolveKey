"use client";

import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import type { Report } from "../lib/api";
import { reportCategoryLabel } from "../lib/report-categories";

export interface MapCanvasProps {
  reports: Report[];
  onSelect: (report: Report) => void;
}

interface ReportGroup {
  key: string;
  reports: Report[];
}

const CATEGORY_COLORS: Record<string, string> = {
  garbage: "#16A777",
  overflowing_dustbin: "#16A777",
  waste_collection: "#148A67",
  dirty_street: "#39846B",
  pothole: "#B98234",
  broken_road: "#B98234",
  damaged_footpath: "#9D7545",
  water_leakage: "#2C9FB3",
  water_supply: "#318DAA",
  sewerage_drainage: "#705E9B",
  street_light: "#C38A28",
  electricity_issue: "#5975C5",
};

const reportIconCache = new Map<string, L.DivIcon>();
const clusterIconCache = new Map<number, L.DivIcon>();

function reportIcon(report: Report): L.DivIcon {
  const category = report.category?.toLowerCase() || "other";
  const severity = report.severity;
  const color = CATEGORY_COLORS[category] || "#64748B";
  const severityTone = severity === null ? "unknown" : severity >= 4 ? "critical" : severity === 3 ? "moderate" : "normal";
  const cacheKey = `${color}:${severityTone}`;
  const cached = reportIconCache.get(cacheKey);
  if (cached) return cached;

  const icon = L.divIcon({
    className: "eco-marker-icon",
    html: `<span class="eco-report-marker eco-report-marker-${severityTone}" style="--marker-color:${color}"></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
  reportIconCache.set(cacheKey, icon);
  return icon;
}

function clusterIcon(count: number): L.DivIcon {
  const cached = clusterIconCache.get(count);
  if (cached) return cached;

  const icon = L.divIcon({
    className: "eco-marker-icon",
    html: `<span class="eco-cluster-marker">${count}</span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });
  clusterIconCache.set(count, icon);
  return icon;
}

function projectToWorld(report: Report, zoom: number): { x: number; y: number } {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, report.lat));
  const sin = Math.sin((latitude * Math.PI) / 180);
  const worldSize = 256 * 2 ** zoom;
  return {
    x: ((report.lng + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize,
  };
}

function groupReports(reports: Report[], zoom: number): ReportGroup[] {
  if (zoom >= 16) {
    return reports.map((report) => ({ key: `report-${report.id}`, reports: [report] }));
  }

  const groups = new Map<string, Report[]>();
  const cellSize = 64;
  for (const report of reports) {
    const point = projectToWorld(report, zoom);
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
    const group = groups.get(key);
    if (group) group.push(report);
    else groups.set(key, [report]);
  }

  return Array.from(groups, ([key, groupedReports]) => ({ key, reports: groupedReports }));
}

function MarkerLayer({ reports, onSelect }: MapCanvasProps) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  const groups = useMemo(() => groupReports(reports, zoom), [reports, zoom]);

  useEffect(() => {
    const updateZoom = () => setZoom(map.getZoom());
    map.on("zoomend", updateZoom);
    return () => {
      map.off("zoomend", updateZoom);
    };
  }, [map]);

  return (
    <>
      {groups.map((group) => {
        if (group.reports.length === 1) {
          const report = group.reports[0];
          return (
            <Marker
              key={group.key}
              position={[report.lat, report.lng]}
              icon={reportIcon(report)}
              title={reportCategoryLabel(report.category)}
              eventHandlers={{ click: () => onSelect(report) }}
            />
          );
        }

        const latitude = group.reports.reduce((sum, report) => sum + report.lat, 0) / group.reports.length;
        const longitude = group.reports.reduce((sum, report) => sum + report.lng, 0) / group.reports.length;
        const position: L.LatLngExpression = [latitude, longitude];
        return (
          <Marker
            key={group.key}
            position={position}
            icon={clusterIcon(group.reports.length)}
            title={`${group.reports.length} reports - zoom in to view`}
            eventHandlers={{
              click: () => map.flyTo(position, Math.min(map.getZoom() + 2, 16)),
            }}
          />
        );
      })}
    </>
  );
}

function InitialViewport({ reports }: { reports: Report[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || reports.length === 0) return;
    fitted.current = true;
    if (reports.length === 1) {
      map.setView([reports[0].lat, reports[0].lng], 14);
      return;
    }

    const bounds = L.latLngBounds(reports.map((report) => L.latLng(report.lat, report.lng)));
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
  }, [map, reports]);

  return null;
}

export function MapCanvas({ reports, onSelect }: MapCanvasProps) {
  return (
    <MapContainer
      center={[24.8607, 67.0011]}
      className="h-full w-full"
      zoom={12}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <InitialViewport reports={reports} />
      <MarkerLayer reports={reports} onSelect={onSelect} />
    </MapContainer>
  );
}
