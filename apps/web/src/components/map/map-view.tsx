"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { LatLng } from "@nevile/core";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn.ts";
import {
  circlePolygon,
  loadMapLibre,
  MAP_STYLE_URL,
  NOVA_SCOTIA_VIEW,
  prefersReducedMotion,
} from "./load-maplibre.ts";

export type MapPin = { id: string; lat: number; lng: number; label: string };

type MapViewProps = {
  /** What the map shows, for screen readers (the same information is always listed too). */
  label: string;
  pins?: readonly MapPin[];
  /** A service-area circle. */
  area?: { center: LatLng; radiusKm: number } | null;
  selectedId?: string | null;
  onSelectPin?: (id: string) => void;
  /** Service-area editor: a draggable pin; clicking the map moves it too. */
  onMovePin?: (point: LatLng) => void;
  className?: string;
};

const AREA_SOURCE = "nevile-area";

/**
 * MapLibre map with result pins and/or a service-area circle. It's an extra view: every
 * page that shows one also lists the same information, so a map that can't load (no
 * WebGL, tiles blocked) just shows a short note.
 */
export function MapView({
  label,
  pins = [],
  area = null,
  selectedId = null,
  onSelectPin,
  onMovePin,
  className,
}: MapViewProps) {
  const containerRef = useRef<HTMLElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const editMarkerRef = useRef<Marker | null>(null);
  const callbacks = useRef({ onSelectPin, onMovePin });
  callbacks.current = { onSelectPin, onMovePin };
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const editable = onMovePin !== undefined;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let resizeObserver: ResizeObserver | null = null;
    loadMapLibre()
      .then((lib) => {
        if (cancelled || !containerRef.current) return;
        map = new lib.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          center: NOVA_SCOTIA_VIEW.center,
          zoom: NOVA_SCOTIA_VIEW.zoom,
          attributionControl: { compact: true },
          cooperativeGestures: !editable,
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.touchZoomRotate.disableRotation();
        // Maps in collapsed panels (the phone "Show map" toggle) start at zero size.
        resizeObserver = new ResizeObserver(() => map?.resize());
        resizeObserver.observe(containerRef.current);
        map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
        mapRef.current = map;
        map.on("load", () => {
          if (cancelled || !map) return;
          map.addSource(AREA_SOURCE, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: `${AREA_SOURCE}-fill`,
            type: "fill",
            source: AREA_SOURCE,
            paint: { "fill-color": "#1f6f50", "fill-opacity": 0.12 },
          });
          map.addLayer({
            id: `${AREA_SOURCE}-line`,
            type: "line",
            source: AREA_SOURCE,
            paint: { "line-color": "#1f6f50", "line-width": 2 },
          });
          setReady(true);
        });
        map.on("error", (event) => {
          // A style that never loads leaves a blank map: say so instead.
          if (!map?.isStyleLoaded()) setFailed(true);
          console.warn("[map]", event.error?.message ?? event);
        });
        if (editable) {
          map.on("click", (event) => {
            callbacks.current.onMovePin?.({ lat: event.lngLat.lat, lng: event.lngLat.lng });
          });
        }
      })
      .catch((error: unknown) => {
        console.warn("[map] could not start", error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      for (const marker of markersRef.current.values()) marker.remove();
      markersRef.current.clear();
      editMarkerRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, [editable]);

  // Result pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let cancelled = false;
    void loadMapLibre().then((lib) => {
      if (cancelled) return;
      const markers = markersRef.current;
      const wanted = new Set(pins.map((pin) => pin.id));
      for (const [id, marker] of markers) {
        if (!wanted.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      }
      for (const pin of pins) {
        let marker = markers.get(pin.id);
        if (!marker) {
          const element = document.createElement("div");
          element.className = "nv-map-pin";
          element.setAttribute("aria-hidden", "true");
          element.title = pin.label;
          element.addEventListener("click", (event) => {
            event.stopPropagation();
            callbacks.current.onSelectPin?.(pin.id);
          });
          marker = new lib.Marker({ element }).setLngLat([pin.lng, pin.lat]).addTo(map);
          markers.set(pin.id, marker);
        } else {
          marker.setLngLat([pin.lng, pin.lat]);
        }
        marker.getElement().dataset.selected = String(pin.id === selectedId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, pins, selectedId]);

  // Area circle and the editable base pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const source = map.getSource(AREA_SOURCE) as GeoJSONSource | undefined;
    void source?.setData(
      area
        ? circlePolygon(area.center, area.radiusKm)
        : { type: "FeatureCollection", features: [] },
    );
    if (!editable) return;
    let cancelled = false;
    void loadMapLibre().then((lib) => {
      if (cancelled) return;
      if (!area) {
        editMarkerRef.current?.remove();
        editMarkerRef.current = null;
        return;
      }
      if (!editMarkerRef.current) {
        const element = document.createElement("div");
        element.className = "nv-map-pin nv-map-pin-base";
        element.setAttribute("aria-hidden", "true");
        const marker = new lib.Marker({ element, draggable: true })
          .setLngLat([area.center.lng, area.center.lat])
          .addTo(map);
        marker.on("dragend", () => {
          const point = marker.getLngLat();
          callbacks.current.onMovePin?.({ lat: point.lat, lng: point.lng });
        });
        editMarkerRef.current = marker;
      } else {
        editMarkerRef.current.setLngLat([area.center.lng, area.center.lat]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, area, editable]);

  // Keep everything in view when the content changes (not on every pin selection).
  const viewKey = JSON.stringify([
    pins.map((pin) => pin.id),
    area?.radiusKm,
    editable ? null : area?.center,
  ]);
  const lastViewKey = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || lastViewKey.current === viewKey) return;
    lastViewKey.current = viewKey;
    void loadMapLibre().then((lib) => {
      const bounds = new lib.LngLatBounds();
      for (const pin of pins) bounds.extend([pin.lng, pin.lat]);
      if (area) {
        for (const [lng, lat] of circlePolygon(area.center, area.radiusKm, 16).geometry
          .coordinates[0] ?? []) {
          bounds.extend([lng, lat]);
        }
      }
      if (bounds.isEmpty()) return;
      map.fitBounds(bounds, {
        padding: 40,
        maxZoom: 12,
        duration: prefersReducedMotion() ? 0 : 400,
      });
    });
  }, [ready, viewKey, pins, area]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-card border border-border bg-subtle",
        className,
      )}
    >
      <section ref={containerRef} aria-label={label} className="absolute inset-0" />
      {failed ? (
        <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
          The map couldn&apos;t load right now. Everything it shows is listed on this page.
        </p>
      ) : null}
    </div>
  );
}
