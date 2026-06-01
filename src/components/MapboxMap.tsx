import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

interface MapboxMapProps {
  lat: number;
  lng: number;
  projectName: string;
  mapsUrl: string;
  accessToken: string;
}

export default function MapboxMap({ lat, lng, projectName, mapsUrl, accessToken }: MapboxMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    mapboxgl.accessToken = accessToken;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [lng, lat],
      zoom: 16,
      interactive: true,
      attributionControl: false,
    });

    map.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    const markerEl = document.createElement('div');
    markerEl.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="background:#EF7C25;color:white;font-size:12px;font-weight:700;padding:4px 10px;border-radius:6px;white-space:nowrap;margin-bottom:4px;box-shadow:0 2px 6px rgba(0,0,0,0.2);">
          ${projectName}
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 24 32" fill="none">
          <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 20 12 20s12-11 12-20c0-6.627-5.373-12-12-12z" fill="#EF7C25"/>
          <circle cx="12" cy="12" r="5" fill="white"/>
        </svg>
      </div>
    `;
    markerEl.style.cursor = 'pointer';

    new mapboxgl.Marker({ element: markerEl, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(map.current);

    markerEl.addEventListener('click', () => {
      window.open(mapsUrl, '_blank');
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [lat, lng, mapsUrl, accessToken]);

  return (
    <div className="w-full h-full min-h-[400px] rounded-[10px] overflow-hidden">
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
}
