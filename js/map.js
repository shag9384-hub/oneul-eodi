/* 오늘어디 — 지도 어댑터
 *  기본: Leaflet + CARTO Voyager (키 필요 없음)
 *  설정 시: 카카오맵 SDK (같은 인터페이스로 교체)
 */

import { STATUS_META, esc } from './util.js';

export const INCHEON_CENTER = { lat: 37.4563, lng: 126.7052 };
export const INCHEON_ZOOM = 12;

const TILE_URL = (window.ENV && window.ENV.TILE_URL) || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = (window.ENV && window.ENV.TILE_ATTR) || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자';

const CAT_EMOJI = {
  '붕어빵·호떡': '🐟', '순대': '🍲', '꼬치': '🍢', '통닭·바베큐': '🍗',
  '타코야키': '🐙', '떡볶이·분식': '🍜', '곱창': '🥘', '디저트·간식': '🍪', '기타': '🥡'
};

function pinClass(status) {
  if (status === 'live') return 'pin-live';
  if (status === 'open') return 'pin-open';
  return 'pin-idle';
}

function pinHTML(place, status) {
  const emoji = CAT_EMOJI[place.category] || '🍴';
  const shortName = place.name.length > 11 ? place.name.slice(0, 11) + '…' : place.name;
  return `<div class="oe-pin ${pinClass(status)}" data-id="${esc(place.id)}">
    <span class="pin-body"><span class="pin-emoji">${emoji}</span><span class="pin-name">${esc(shortName)}</span></span>
    <span class="pin-tail"></span>
  </div>`;
}

/* ── Leaflet ───────────────────────────────────────────── */
class LeafletAdapter {
  constructor() { this.kind = 'leaflet'; this.selectedId = null; this.places = []; }

  init(el, { center, zoom, onPick }) {
    this.el = el;
    this.onPick = onPick;
    this.map = L.map(el, {
      center: [center.lat, center.lng],
      zoom,
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
      zoomSnap: 0.5
    });
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    this.tiles = L.tileLayer(TILE_URL, {
      maxZoom: 19,
      subdomains: 'abc',
      attribution: TILE_ATTR,
      detectRetina: false
    }).addTo(this.map);
    this.tiles.on('tileerror', () => { /* 타일 한 장 실패는 무시 */ });

    this.cluster = L.markerClusterGroup({
      maxClusterRadius: 46,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      zoomToBoundsOnClick: true,
      chunkedLoading: true,
      iconCreateFunction: (c) => L.divIcon({
        html: `<div class="oe-cluster">${c.getChildCount()}<small>곳</small></div>`,
        className: 'oe-cluster-wrap',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      })
    }).addTo(this.map);

    this.meLayer = L.layerGroup().addTo(this.map);
    this.pickLayer = L.layerGroup().addTo(this.map);

    this.map.on('click', (e) => {
      if (this.picking && this.onPick) this.onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
  }

  setMarkers(places, { onClick, selectedId } = {}) {
    this.selectedId = selectedId || null;
    this.cluster.clearLayers();
    const markers = [];
    for (const place of places) {
      if (place.lat == null || place.lng == null) continue;
      const marker = L.marker([place.lat, place.lng], {
        icon: L.divIcon({
          html: pinHTML(place, place._status),
          className: 'oe-pin-wrap',
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        }),
        title: place.name,
        keyboard: true,
        riseOnHover: true
      });
      marker.on('click', () => onClick && onClick(place.id));
      marker.on('mouseover', () => marker.setZIndexOffset(600));
      marker.on('mouseout', () => marker.setZIndexOffset(0));
      if (this.selectedId === place.id) {
        const node = marker.getElement();
        if (node) node.querySelector('.oe-pin')?.classList.add('is-selected');
      }
      markers.push(marker);
    }
    this.cluster.addLayers(markers);
  }

  refreshSelection(places) {
    // divIcon 은 DOM 이 다시 그려지므로, 선택 표시는 setMarkers 로만 갱신
    this.setMarkers(places, { onClick: this._onClick, selectedId: this.selectedId });
  }

  setCenter(lat, lng, zoom) {
    if (zoom) this.map.setView([lat, lng], zoom, { animate: true });
    else this.map.panTo([lat, lng], { animate: true });
  }

  flyTo(lat, lng, zoom = 15) {
    this.map.flyTo([lat, lng], zoom, { duration: 0.6 });
  }

  fitBounds(bounds, padding = [30, 30]) {
    if (!bounds) return;
    this.map.fitBounds([[bounds.south, bounds.west], [bounds.north, bounds.east]], { padding });
  }

  showMe(lat, lng) {
    this.meLayer.clearLayers();
    const icon = L.divIcon({ html: '<div class="my-dot"></div>', className: 'my-dot-wrap', iconSize: [16, 16], iconAnchor: [8, 8] });
    L.marker([lat, lng], { icon, interactive: false }).addTo(this.meLayer);
  }

  setPickMode(on) {
    this.picking = on;
    if (!on) this.pickLayer.clearLayers();
  }

  showPick(lat, lng) {
    this.pickLayer.clearLayers();
    const icon = L.divIcon({ html: pinHTML({ id: 'pick', name: '여기!', category: '기타' }, 'live'), className: 'oe-pin-wrap', iconSize: [0, 0], iconAnchor: [0, 0] });
    L.marker([lat, lng], { icon, interactive: false }).addTo(this.pickLayer);
  }

  invalidate() { this.map.invalidateSize(); }
}

/* ── Kakao ─────────────────────────────────────────────── */
function loadKakaoSdk(key, timeout = 6000) {
  return new Promise((resolve, reject) => {
    if (window.kakao?.maps?.Map) { resolve(); return; }
    const existing = document.querySelector('script[data-oe-kakao]');
    const start = Date.now();
    const check = () => {
      if (window.kakao?.maps) {
        window.kakao.maps.load(() => resolve());
        return;
      }
      if (Date.now() - start > timeout) { reject(new Error('카카오맵 SDK 응답 없음')); return; }
      setTimeout(check, 120);
    };
    if (!existing) {
      const s = document.createElement('script');
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false&libraries=clusterer`;
      s.async = true;
      s.dataset.oeKakao = '1';
      s.onerror = () => reject(new Error('카카오맵 SDK 로드 실패'));
      document.head.appendChild(s);
    }
    check();
  });
}

function kakaoPinImage(status) {
  const fill = status === 'live' ? '#EA580C' : (status === 'open' ? '#1C1917' : '#B9B0A4');
  const inner = status === 'live' ? '#FFFDF9' : (status === 'open' ? '#EA580C' : '#FFFDF9');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">
    <path d="M17 43C17 43 32 26.5 32 17.5A15 15 0 1 0 2 17.5C2 26.5 17 43 17 43Z" fill="${fill}" stroke="#FFFDF9" stroke-width="2"/>
    <circle cx="17" cy="17.5" r="5.8" fill="${inner}"/>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

class KakaoAdapter {
  constructor() { this.kind = 'kakao'; this.selectedId = null; }

  async init(el, { key, center, zoom, onPick }) {
    await loadKakaoSdk(key);
    if (!window.kakao?.maps?.Map) throw new Error('카카오맵 초기화 실패');
    this.el = el;
    this.onPick = onPick;
    this.map = new window.kakao.maps.Map(el, {
      center: new window.kakao.maps.LatLng(center.lat, center.lng),
      level: zoom ? Math.max(2, Math.round(15 - zoom)) : 7
    });
    this.map.setZoomable(true);
    this.clusterer = new window.kakao.maps.MarkerClusterer({
      map: this.map,
      averageCenter: true,
      minLevel: 6,
      disableClickZoom: false,
      styles: [{
        width: '42px', height: '42px', background: '#1C1917', color: '#FAF7F2',
        borderRadius: '21px', textAlign: 'center', lineHeight: '42px',
        fontSize: '12px', fontWeight: '700', border: '2px solid #FAF7F2',
        boxShadow: '0 0 0 3px rgba(234,88,12,.3)'
      }]
    });
    this.markers = [];
    window.kakao.maps.event.addListener(this.map, 'click', (e) => {
      if (this.picking && this.onPick) this.onPick({ lat: e.latLng.getLat(), lng: e.latLng.getLng() });
    });
    this.meOverlay = null;
    this.pickMarker = null;
  }

  setMarkers(places, { onClick, selectedId } = {}) {
    this.selectedId = selectedId || null;
    this._onClick = onClick;
    this.clusterer.clear();
    this.markers = [];
    const K = window.kakao.maps;
    for (const place of places) {
      if (place.lat == null || place.lng == null) continue;
      const image = new K.MarkerImage(
        kakaoPinImage(place._status),
        new K.Size(34, 44),
        { offset: new K.Point(17, 44) }
      );
      const marker = new K.Marker({
        position: new K.LatLng(place.lat, place.lng),
        image,
        title: place.name,
        clickable: true
      });
      K.event.addListener(marker, 'click', () => onClick && onClick(place.id));
      this.markers.push(marker);
    }
    this.clusterer.addMarkers(this.markers);
  }

  refreshSelection(places) { this.setMarkers(places, { onClick: this._onClick, selectedId: this.selectedId }); }

  setCenter(lat, lng, zoom) {
    const K = window.kakao.maps;
    this.map.setCenter(new K.LatLng(lat, lng));
    if (zoom) this.map.setLevel(Math.max(2, Math.round(15 - zoom)));
  }

  flyTo(lat, lng, zoom = 15) {
    this.setCenter(lat, lng, zoom);
  }

  fitBounds(bounds) {
    if (!bounds) return;
    const K = window.kakao.maps;
    const sw = new K.LatLng(bounds.south, bounds.west);
    const ne = new K.LatLng(bounds.north, bounds.east);
    this.map.setBounds(new K.LatLngBounds(sw, ne));
  }

  showMe(lat, lng) {
    const K = window.kakao.maps;
    if (this.meOverlay) this.meOverlay.setMap(null);
    const content = '<div style="width:16px;height:16px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.18)"></div>';
    this.meOverlay = new K.CustomOverlay({
      position: new K.LatLng(lat, lng), content, yAnchor: 0.5, xAnchor: 0.5, zIndex: 5
    });
    this.meOverlay.setMap(this.map);
  }

  setPickMode(on) {
    this.picking = on;
    if (!on && this.pickMarker) { this.pickMarker.setMap(null); this.pickMarker = null; }
  }

  showPick(lat, lng) {
    const K = window.kakao.maps;
    if (this.pickMarker) this.pickMarker.setMap(null);
    this.pickMarker = new K.Marker({ position: new K.LatLng(lat, lng), draggable: false });
    this.pickMarker.setMap(this.map);
  }

  invalidate() { this.map.relayout(); }
}

/** 카카오 키가 있으면 카카오, 없거나 실패하면 Leaflet 으로 */
export async function createMapAdapter({ el, key, center = INCHEON_CENTER, zoom = INCHEON_ZOOM, onPick }) {
  if (key) {
    try {
      el.innerHTML = '';
      const adapter = new KakaoAdapter();
      await adapter.init(el, { key, center, zoom, onPick });
      return adapter;
    } catch (err) {
      console.warn('[오늘어디] 카카오맵을 불러오지 못해 기본 지도로 전환합니다.', err.message || err);
      el.innerHTML = '';
      const adapter = new LeafletAdapter();
      adapter.init(el, { center, zoom, onPick });
      adapter.fallbackReason = err.message || '카카오맵 로드 실패';
      return adapter;
    }
  }
  const adapter = new LeafletAdapter();
  adapter.init(el, { center, zoom, onPick });
  return adapter;
}
