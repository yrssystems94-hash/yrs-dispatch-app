const ROUTE_CONFIG = {
  apiBaseUrl:
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
      ? "http://localhost:4000"
      : "https://yrs-lead-api.onrender.com",

  routesStorageKey: "yrs_routes",
  activeRouteIdStorageKey: "yrs_active_route_id",
  fallbackCenterLat: 43.4516,
  fallbackCenterLng: -80.4925,
};

(function () {
  const els = {
    openFullRouteBtn: document.getElementById("openFullRouteBtn"),
    backToDashboardBtn: document.getElementById("backToDashboardBtn"),
    deleteRouteBtn: document.getElementById("deleteRouteBtn"),
    refreshRouteBtn: document.getElementById("refreshRouteBtn"),
    reoptimizeRouteBtn: document.getElementById("reoptimizeRouteBtn"),
    addStopBtn: document.getElementById("addStopBtn"),
    stopsList: document.getElementById("stopsList"),
    statusBar: document.getElementById("statusBar"),
    routeSelector: document.getElementById("routeSelector"),
    stopCountValue: document.getElementById("stopCountValue"),
    urgentCountValue: document.getElementById("urgentCountValue"),
    doneCountValue: document.getElementById("doneCountValue"),
    routeTypeValue: document.getElementById("routeTypeValue"),
    routeStats: document.getElementById("routeStats"),
    mapNote: document.getElementById("mapNote"),
    routeMap: document.getElementById("routeMap"),
  };

  let map = null;
  let tileLayer = null;
  let routePolyline = null;
  let markerLayer = null;
  let markersByStopIndex = new Map();
  let lastBoundsPoints = [];
  let fallbackMessageRendered = false;

  function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDisplay(value, fallback = "N/A") {
    const text = normalizeString(String(value || ""));
    return text || fallback;
  }

  function getApiUrl(path) {
    return `${ROUTE_CONFIG.apiBaseUrl}${path}`;
  }

  function getRoutes() {
    try {
      const raw = window.localStorage.getItem(ROUTE_CONFIG.routesStorageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function setRoutes(routes) {
    window.localStorage.setItem(
      ROUTE_CONFIG.routesStorageKey,
      JSON.stringify(Array.isArray(routes) ? routes : [])
    );
  }

  function getActiveRouteId() {
    return normalizeString(
      window.localStorage.getItem(ROUTE_CONFIG.activeRouteIdStorageKey)
    );
  }

  function setActiveRouteId(routeId) {
    window.localStorage.setItem(
      ROUTE_CONFIG.activeRouteIdStorageKey,
      normalizeString(routeId)
    );
  }

  function clearActiveRouteId() {
    window.localStorage.removeItem(ROUTE_CONFIG.activeRouteIdStorageKey);
  }

  function getActiveRoute() {
    const activeRouteId = getActiveRouteId();
    const routes = getRoutes();

    if (!activeRouteId) return routes.length ? routes[routes.length - 1] : null;
    return routes.find((route) => normalizeString(route.id) === activeRouteId) || null;
  }

  function saveRoute(updatedRoute) {
    const routes = getRoutes().map((route) =>
      normalizeString(route.id) === normalizeString(updatedRoute.id)
        ? updatedRoute
        : route
    );
    setRoutes(routes);
    setActiveRouteId(updatedRoute.id);
  }

  function removeRouteFromStorage(routeId) {
    const nextRoutes = getRoutes().filter(
      (route) => normalizeString(route.id) !== normalizeString(routeId)
    );

    setRoutes(nextRoutes);

    const activeRouteId = getActiveRouteId();
    if (activeRouteId === normalizeString(routeId)) {
      if (nextRoutes.length) {
        setActiveRouteId(nextRoutes[nextRoutes.length - 1].id);
      } else {
        clearActiveRouteId();
      }
    }
  }

  function getLeadId(lead) {
    return normalizeString(lead?.lead_id) || normalizeString(lead?.id);
  }

  function getStopId(stop) {
    return normalizeString(stop?.custom_id) || getLeadId(stop);
  }

  function isCustomStop(stop) {
    return stop?.is_custom === true;
  }

  function getLeadAddress(lead) {
    return (
      normalizeString(lead?.property_address) ||
      normalizeString(lead?.full_address) ||
      normalizeString(lead?.address) ||
      [
        normalizeString(lead?.property_address),
        normalizeString(lead?.city),
        normalizeString(lead?.province),
        normalizeString(lead?.postal_code),
      ]
        .filter(Boolean)
        .join(", ")
    );
  }

  function getLat(lead) {
    const value = Number(lead?.lat);
    return Number.isFinite(value) ? value : null;
  }

  function getLng(lead) {
    const value = Number(lead?.lng);
    return Number.isFinite(value) ? value : null;
  }

  function isValidCoordPair(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return false;
    if (lat < -90 || lat > 90) return false;
    if (lng < -180 || lng > 180) return false;
    return true;
  }

  function hasCoordinates(lead) {
    return isValidCoordPair(getLat(lead), getLng(lead));
  }

  function getRouteStartPoint(route) {
    const startLat = Number(route?.startLat);
    const startLng = Number(route?.startLng);

    if (isValidCoordPair(startLat, startLng)) {
      return {
        lat: startLat,
        lng: startLng,
        address: normalizeString(route?.startAddress),
        source: normalizeString(route?.startSource) || "saved",
      };
    }

    const firstStop = Array.isArray(route?.stops)
      ? route.stops.find(hasCoordinates)
      : null;

    if (firstStop) {
      return {
        lat: getLat(firstStop),
        lng: getLng(firstStop),
        address: normalizeString(route?.startAddress) || getLeadAddress(firstStop),
        source: "first_stop_fallback",
      };
    }

    return {
      lat: ROUTE_CONFIG.fallbackCenterLat,
      lng: ROUTE_CONFIG.fallbackCenterLng,
      address: normalizeString(route?.startAddress),
      source: "global_fallback",
    };
  }

  function isUrgentStop(lead) {
    const routeStatus = normalizeString(lead?.route_status).toLowerCase();
    const priority = normalizeString(lead?.priority).toLowerCase();
    const serviceType = normalizeString(lead?.service_type).toLowerCase();

    if (routeStatus === "done" || routeStatus === "arrived") return false;

    return (
      priority.includes("urgent") ||
      priority.includes("emergency") ||
      serviceType.includes("emergency") ||
      serviceType.includes("leak")
    );
  }

  function getBadgeText(lead) {
    if (isCustomStop(lead)) return "Custom";

    const routeStatus = normalizeString(lead?.route_status).toLowerCase();
    const priority = normalizeString(lead?.priority).toLowerCase();
    const serviceType = normalizeString(lead?.service_type).toLowerCase();

    if (routeStatus === "done") return "Done";
    if (routeStatus === "arrived") return "Arrived";
    if (priority.includes("urgent")) return "Urgent";
    if (serviceType.includes("emergency") || serviceType.includes("leak")) return "Emergency";

    return "Routed";
  }

  function getBadgeClass(lead) {
    if (isCustomStop(lead)) return "custom";
    const badge = getBadgeText(lead).toLowerCase();
    if (badge === "urgent" || badge === "emergency") return "urgent";
    if (badge === "done") return "done";
    if (badge === "arrived") return "arrived";
    return "";
  }

  function setStatus(message) {
    if (!els.statusBar) return;
    els.statusBar.textContent = message || "";
  }

  async function postJson(path, body) {
    const response = await fetch(getApiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });

    const json = await response.json().catch(() => null);

    if (!response.ok || !json || json.success !== true) {
      throw new Error(json?.details || json?.error || json?.message || `POST failed: ${path}`);
    }

    return json;
  }

  async function geocodeAddress(address) {
    const clean = normalizeString(address);
    if (!clean) return null;

    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "1");
      url.searchParams.set("q", clean);

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) return null;
      const data = await response.json();
      const first = Array.isArray(data) ? data[0] : null;
      if (!first) return null;

      const lat = Number(first.lat);
      const lng = Number(first.lon);
      if (!isValidCoordPair(lat, lng)) return null;

      return {
        lat,
        lng,
        address: first.display_name || clean,
      };
    } catch (_) {
      return null;
    }
  }

  function buildGoogleMapsDirectionsUrl(route) {
    const stops = Array.isArray(route?.stops) ? route.stops : [];
    const startAddress = normalizeString(route?.startAddress);
    const endMode = normalizeString(route?.endMode || "last");

    if (!stops.length) return "";

    const addresses = stops.map(getLeadAddress).filter(Boolean);
    if (!addresses.length) return "";

    const origin = startAddress || addresses[0];
    let destination = addresses[addresses.length - 1];
    let waypoints = addresses.slice(0, -1);

    if (endMode === "round_trip") {
      destination = origin;
      waypoints = addresses;
    }

    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", origin);
    url.searchParams.set("destination", destination);

    if (waypoints.length) {
      url.searchParams.set("waypoints", waypoints.join("|"));
    }

    return url.toString();
  }

  function getMapPadding() {
    return window.innerWidth <= 640 ? [18, 18] : [30, 30];
  }

  function invalidateAndRefitMap() {
    if (!map) return;

    const refit = () => {
      if (!map) return;
      map.invalidateSize();

      if (lastBoundsPoints.length === 1) {
        map.setView(lastBoundsPoints[0], 14);
      } else if (lastBoundsPoints.length > 1) {
        map.fitBounds(lastBoundsPoints, { padding: getMapPadding() });
      }
    };

    requestAnimationFrame(refit);
    setTimeout(refit, 120);
    setTimeout(refit, 380);
    setTimeout(refit, 760);
  }

  function renderEmpty() {
    if (els.routeMap) {
      els.routeMap.innerHTML = `
        <div class="map-fallback">
          No active route found. Go back to the dashboard and optimize a route first.
        </div>
      `;
    }

    if (els.stopsList) els.stopsList.innerHTML = "";
    if (els.openFullRouteBtn) els.openFullRouteBtn.disabled = true;
    if (els.deleteRouteBtn) els.deleteRouteBtn.disabled = true;
    if (els.addStopBtn) els.addStopBtn.disabled = true;
    if (els.reoptimizeRouteBtn) els.reoptimizeRouteBtn.disabled = true;

    if (els.routeSelector) {
      els.routeSelector.innerHTML = `<option value="">No routes</option>`;
      els.routeSelector.disabled = true;
    }

    if (els.stopCountValue) els.stopCountValue.textContent = "0";
    if (els.urgentCountValue) els.urgentCountValue.textContent = "0";
    if (els.doneCountValue) els.doneCountValue.textContent = "0";
    if (els.routeTypeValue) els.routeTypeValue.textContent = "Standard";
    if (els.routeStats) els.routeStats.innerHTML = "";
    if (els.mapNote) {
      els.mapNote.textContent =
        "No route is loaded yet. Build one from the dispatch dashboard.";
    }

    destroyMap();
    setStatus("No active route loaded.");
  }

  function destroyMap() {
    markersByStopIndex = new Map();
    fallbackMessageRendered = false;
    lastBoundsPoints = [];

    if (map) {
      map.remove();
      map = null;
      tileLayer = null;
      routePolyline = null;
      markerLayer = null;
    }
  }

  function ensureMapContainer() {
    if (!els.routeMap) return;
    if (els.routeMap.querySelector(".leaflet-container")) return;
    els.routeMap.innerHTML = "";
  }

  function initMapIfNeeded() {
    if (!els.routeMap) return null;
    if (map) return map;

    ensureMapContainer();

    map = L.map(els.routeMap, {
      zoomControl: true,
      scrollWheelZoom: true,
    });

    tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    });

    tileLayer.addTo(map);
    markerLayer = L.layerGroup().addTo(map);

    requestAnimationFrame(() => {
      invalidateAndRefitMap();
    });

    return map;
  }

  function createStopIcon(index, lead) {
    const badgeClass = getBadgeClass(lead);
    const extraClass = badgeClass ? ` ${badgeClass}` : "";
    return L.divIcon({
      html: `<div class="yrs-stop-pin${extraClass}">${index + 1}</div>`,
      className: "",
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -14],
    });
  }

  function createStartIcon() {
    return L.divIcon({
      html: `<div class="yrs-start-pin">Start</div>`,
      className: "",
      iconSize: [46, 42],
      iconAnchor: [23, 21],
      popupAnchor: [0, -18],
    });
  }

  function focusStopByIndex(stopIndex) {
    const marker = markersByStopIndex.get(Number(stopIndex));
    if (!marker || !map) return;

    const latLng = marker.getLatLng();
    if (!latLng || !Number.isFinite(latLng.lat) || !Number.isFinite(latLng.lng)) return;

    map.flyTo(latLng, Math.max(map.getZoom(), 14), {
      animate: true,
      duration: 0.6,
    });

    marker.openPopup();

    Array.from(document.querySelectorAll(".stop-card")).forEach((card) => {
      const cardIndex = Number(card.getAttribute("data-stop-index"));
      card.classList.toggle("active", cardIndex === Number(stopIndex));
    });
  }

  function renderRouteSelector() {
    if (!els.routeSelector) return;

    const routes = getRoutes();
    const activeRouteId = getActiveRouteId();

    if (!routes.length) {
      els.routeSelector.innerHTML = `<option value="">No routes</option>`;
      els.routeSelector.disabled = true;
      return;
    }

    els.routeSelector.disabled = false;
    els.routeSelector.innerHTML = routes
      .map((route, index) => {
        const label =
          normalizeString(route?.label) ||
          `Route ${index + 1} - ${new Date(route.createdAt || Date.now()).toLocaleString()}`;
        const selected =
          normalizeString(route.id) === normalizeString(activeRouteId)
            ? "selected"
            : "";

        return `<option value="${escapeHtml(route.id)}" ${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");
  }

  function updateReoptimizeButton(route) {
    if (!els.reoptimizeRouteBtn) return;
    const edited = route?.wasEdited === true;
    els.reoptimizeRouteBtn.textContent = edited
      ? "Reoptimize Route"
      : "Optimize Current Route";
    els.reoptimizeRouteBtn.disabled = false;
  }

  function renderRouteStats(route) {
    const stops = Array.isArray(route?.stops) ? route.stops : [];
    const urgentCount = stops.filter(isUrgentStop).length;
    const doneCount = stops.filter(
      (stop) => normalizeString(stop?.route_status).toLowerCase() === "done"
    ).length;
    const groupedCount = stops.filter((stop) => Number(stop?.grouped_count || 1) > 1).length;
    const customCount = stops.filter(isCustomStop).length;
    const routeType = normalizeString(route?.type || "standard");
    const endMode = normalizeString(route?.endMode || "last");
    const assignedDay = normalizeString(route?.assignedDay || "");
    const cityList = Array.from(
      new Set(stops.map((stop) => normalizeString(stop?.city)).filter(Boolean))
    );

    if (els.stopCountValue) els.stopCountValue.textContent = String(stops.length);
    if (els.urgentCountValue) els.urgentCountValue.textContent = String(urgentCount);
    if (els.doneCountValue) els.doneCountValue.textContent = String(doneCount);
    if (els.routeTypeValue) {
      els.routeTypeValue.textContent = routeType === "emergency" ? "Emergency" : "Standard";
    }

    if (els.routeStats) {
      const chips = [
        assignedDay || null,
        `${stops.length} Stop${stops.length === 1 ? "" : "s"}`,
        `${urgentCount} Urgent`,
        `${doneCount} Done`,
        endMode === "round_trip" ? "Round Trip" : "Last Location",
        groupedCount ? `${groupedCount} Multi-job Stop${groupedCount === 1 ? "" : "s"}` : null,
        customCount ? `${customCount} Custom Stop${customCount === 1 ? "" : "s"}` : null,
        cityList.length ? cityList.join(" / ") : null,
        route?.wasEdited ? "Edited Route" : null,
      ].filter(Boolean);

      els.routeStats.innerHTML = chips
        .map((chip) => `<div class="stat-chip">${escapeHtml(chip)}</div>`)
        .join("");
    }

    updateReoptimizeButton(route);
  }

  function renderMap(route) {
    const stops = Array.isArray(route?.stops) ? route.stops : [];
    const startPoint = getRouteStartPoint(route);
    const endMode = normalizeString(route?.endMode || "last");
    const m = initMapIfNeeded();

    if (!m) return;

    markersByStopIndex = new Map();

    if (markerLayer) markerLayer.clearLayers();
    if (routePolyline) {
      routePolyline.remove();
      routePolyline = null;
    }

    const boundsPoints = [];
    const linePoints = [];

    if (!stops.length) {
      renderEmpty();
      return;
    }

    if (isValidCoordPair(startPoint.lat, startPoint.lng)) {
      const startMarker = L.marker([startPoint.lat, startPoint.lng], {
        icon: createStartIcon(),
        zIndexOffset: 1000,
      }).bindPopup(
        `<strong>Start</strong><br>${escapeHtml(startPoint.address || "Selected starting point")}`
      );

      markerLayer.addLayer(startMarker);
      boundsPoints.push([startPoint.lat, startPoint.lng]);
    }

    stops.forEach((lead, index) => {
      if (!hasCoordinates(lead)) return;

      const lat = getLat(lead);
      const lng = getLng(lead);
      if (!isValidCoordPair(lat, lng)) return;

      const marker = L.marker([lat, lng], {
        icon: createStopIcon(index, lead),
      }).bindPopup(`
        <strong>Stop ${index + 1}</strong><br>
        ${escapeHtml(getLeadAddress(lead))}<br>
        ${escapeHtml(formatDisplay(lead?.service_type || (isCustomStop(lead) ? "Custom stop" : "")))} • ${escapeHtml(getBadgeText(lead))}
      `);

      marker.on("click", function () {
        focusStopByIndex(index);
      });

      markerLayer.addLayer(marker);
      markersByStopIndex.set(index, marker);
      linePoints.push([lat, lng]);
      boundsPoints.push([lat, lng]);
    });

    if (!linePoints.length) {
      destroyMap();
      if (els.routeMap && !fallbackMessageRendered) {
        els.routeMap.innerHTML = `
          <div class="map-fallback">
            This route does not have enough valid map coordinates yet to render a live local-area map.
            The stops are still listed below and the Google Maps route button will still work.
          </div>
        `;
        fallbackMessageRendered = true;
      }

      if (els.mapNote) {
        els.mapNote.textContent = "No valid map pins available yet because these stops are missing coordinates.";
      }
      return;
    }

    let polylinePoints =
      isValidCoordPair(startPoint.lat, startPoint.lng)
        ? [[startPoint.lat, startPoint.lng], ...linePoints]
        : [...linePoints];

    if (endMode === "round_trip" && isValidCoordPair(startPoint.lat, startPoint.lng)) {
      polylinePoints.push([startPoint.lat, startPoint.lng]);
      boundsPoints.push([startPoint.lat, startPoint.lng]);
    }

    if (polylinePoints.length >= 2) {
      routePolyline = L.polyline(polylinePoints, {
        color: "#2f7cf6",
        weight: 5,
        opacity: 0.78,
        lineJoin: "round",
      }).addTo(m);
    }

    lastBoundsPoints = [...boundsPoints];

    if (boundsPoints.length === 1) {
      m.setView(boundsPoints[0], 14);
    } else {
      m.fitBounds(boundsPoints, { padding: getMapPadding() });
    }

    invalidateAndRefitMap();

    if (els.mapNote) {
      const startSourceText =
        startPoint.source === "home" || startPoint.source === "home_fallback"
          ? "Starting at home address."
          : startPoint.source === "first_selected"
          ? "Starting at the first selected address."
          : startPoint.source === "first_stop_fallback"
          ? "Custom start could not be mapped, so the view is anchored to the first stop area."
          : startPoint.source === "global_fallback"
          ? "Start point could not be mapped, so the map is centered on your service area."
          : "Starting with your saved route start.";

      const endModeText =
        endMode === "round_trip"
          ? "Route returns to the start point."
          : "Route ends at the last stop.";

      els.mapNote.textContent = `${linePoints.length} mapped stop${linePoints.length === 1 ? "" : "s"} rendered. ${startSourceText} ${endModeText}`;
    }
  }

  function renderStops(route) {
    const stops = Array.isArray(route?.stops) ? route.stops : [];

    if (!stops.length) {
      if (els.stopsList) {
        els.stopsList.innerHTML = `<div class="empty-state">No stops found for this route.</div>`;
      }
      return;
    }

    if (!els.stopsList) return;

    els.stopsList.innerHTML = stops
      .map((lead, index) => {
        const address = getLeadAddress(lead);
        const serviceType = formatDisplay(
          lead?.service_type,
          isCustomStop(lead) ? "Custom stop" : "N/A"
        );
        const priority = formatDisplay(lead?.priority, isCustomStop(lead) ? "Custom" : "N/A");
        const preferredTime = formatDisplay(lead?.preferred_time, isCustomStop(lead) ? "Manual stop" : "N/A");
        const phone = formatDisplay(lead?.phone, "");
        const routeStatus = normalizeString(lead?.route_status || "routed");
        const groupedCount = Number(lead?.grouped_count || 1);
        const hasMap = hasCoordinates(lead) || Boolean(address);
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

        return `
          <div class="stop-card" data-stop-index="${index}">
            <div class="stop-top">
              <div>
                <div class="stop-number">Stop ${index + 1}</div>
                <div class="stop-address">${escapeHtml(address)}</div>
              </div>
              <div class="badge ${escapeHtml(getBadgeClass(lead))}">
                ${escapeHtml(getBadgeText(lead))}
              </div>
            </div>

            <div class="stop-meta">
              ${escapeHtml(serviceType)} • ${escapeHtml(priority)} • ${escapeHtml(preferredTime)}${
                groupedCount > 1 ? ` • ${escapeHtml(String(groupedCount))} jobs here` : ""
              }
            </div>

            <div class="stop-meta">
              Current Status: ${escapeHtml(routeStatus || "routed")}
            </div>

            <div class="stop-actions">
              <button class="small-btn success" type="button" data-phone="${escapeHtml(phone)}">Call</button>
              <button class="small-btn primary" type="button" data-map="${escapeHtml(mapsUrl)}" ${hasMap ? "" : "disabled"}>Map</button>
              <button class="small-btn dark" type="button" data-arrived="${escapeHtml(getLeadId(lead))}" ${isCustomStop(lead) ? "disabled" : ""}>Arrived</button>
            </div>

            <div class="stop-edit-actions">
              <button class="small-btn danger" type="button" data-done="${escapeHtml(getLeadId(lead))}" ${isCustomStop(lead) ? "disabled" : ""}>Done</button>
              <button class="small-btn edit" type="button" data-move-up="${index}" ${index === 0 ? "disabled" : ""}>Move Up</button>
              <button class="small-btn edit" type="button" data-move-down="${index}" ${index === stops.length - 1 ? "disabled" : ""}>Move Down</button>
            </div>

            <div class="stop-edit-actions">
              <button class="small-btn edit" type="button" data-remove-stop="${index}">Remove</button>
              <button class="small-btn edit" type="button" data-focus-stop="${index}">Focus</button>
              <button class="small-btn edit" type="button" data-add-after="${index}">+ Add After</button>
            </div>
          </div>
        `;
      })
      .join("");

    Array.from(els.stopsList.querySelectorAll(".stop-card")).forEach((card) => {
      card.addEventListener("click", function () {
        const stopIndex = Number(card.getAttribute("data-stop-index"));
        if (!Number.isFinite(stopIndex)) return;
        focusStopByIndex(stopIndex);
      });
    });

    Array.from(els.stopsList.querySelectorAll("[data-phone]")).forEach((btn) => {
      btn.addEventListener("click", function (event) {
        event.stopPropagation();
        const phone = normalizeString(btn.getAttribute("data-phone"));
        if (!phone) {
          window.alert("No phone number available for this stop.");
          return;
        }
        window.location.href = `tel:${phone}`;
      });
    });

    Array.from(els.stopsList.querySelectorAll("[data-map]")).forEach((btn) => {
      btn.addEventListener("click", function (event) {
        event.stopPropagation();
        const mapUrl = normalizeString(btn.getAttribute("data-map"));
        if (!mapUrl) return;
        window.open(mapUrl, "_blank", "noopener,noreferrer");
      });
    });

    Array.from(els.stopsList.querySelectorAll("[data-arrived]")).forEach((btn) => {
      btn.addEventListener("click", async function (event) {
        event.stopPropagation();
        const leadId = normalizeString(btn.getAttribute("data-arrived"));
        if (!leadId) return;
        await markStopStatus(leadId, "arrived");
      });
    });

    Array.from(els.stopsList.querySelectorAll("[data-done]")).forEach((btn) => {
      btn.addEventListener("click", async function (event) {
        event.stopPropagation();
        const leadId = normalizeString(btn.getAttribute("data-done"));
        if (!leadId) return;
        await markStopStatus(leadId, "done");
      });
    });

    Array.from(els.stopsList.querySelectorAll("[data-move-up]")).forEach((btn) => {
      btn.addEventListener("click", function (event) {
        event.stopPropagation();
        const index = Number(btn.getAttribute("data-move-up"));
        moveStop(index, index - 1);
      });
    });

    Array.from(els.stopsList.querySelectorAll("[data-move-down]")).forEach((btn) => {
      btn.addEventListener("click", function (event) {
        event.stopPropagation();
        const index = Number(btn.getAttribute("data-move-down"));
        moveStop(index, index + 1);
      });
    });

    Array.from(els.stopsList.querySelectorAll("[data-remove-stop]")).forEach((btn) => {
      btn.addEventListener("click", async function (event) {
        event.stopPropagation();
        const index = Number(btn.getAttribute("data-remove-stop"));
        await removeStop(index);
      });
    });

    Array.from(els.stopsList.querySelectorAll("[data-focus-stop]")).forEach((btn) => {
      btn.addEventListener("click", function (event) {
        event.stopPropagation();
        const index = Number(btn.getAttribute("data-focus-stop"));
        focusStopByIndex(index);
      });
    });

    Array.from(els.stopsList.querySelectorAll("[data-add-after]")).forEach((btn) => {
      btn.addEventListener("click", async function (event) {
        event.stopPropagation();
        const index = Number(btn.getAttribute("data-add-after"));
        await addCustomStop(index + 1);
      });
    });
  }

  function renderRoute(route) {
    const stops = Array.isArray(route?.stops) ? route.stops : [];

    if (!stops.length) {
      renderEmpty();
      return;
    }

    if (els.openFullRouteBtn) els.openFullRouteBtn.disabled = false;
    if (els.deleteRouteBtn) els.deleteRouteBtn.disabled = false;
    if (els.addStopBtn) els.addStopBtn.disabled = false;
    if (els.reoptimizeRouteBtn) els.reoptimizeRouteBtn.disabled = false;

    renderRouteSelector();
    renderRouteStats(route);
    renderMap(route);
    renderStops(route);

    setStatus(`Route loaded: ${stops.length} stop${stops.length === 1 ? "" : "s"}.`);
  }

  function updateRouteStops(route, updatedStops, extraPatch = {}) {
    const nextRoute = {
      ...route,
      ...extraPatch,
      wasEdited: true,
      stops: updatedStops.map((stop, index) => ({
        ...stop,
        route_order: index,
      })),
    };

    saveRoute(nextRoute);
    renderRoute(nextRoute);
    return nextRoute;
  }

  async function markStopStatus(leadId, status) {
    try {
      await postJson("/api/route/update-status", {
        lead_id: leadId,
        status,
      });

      const route = getActiveRoute();
      if (!route) return;

      const updatedStops = (route.stops || []).map((stop) => {
        if (getLeadId(stop) !== leadId) return stop;
        return { ...stop, route_status: status };
      });

      updateRouteStops(route, updatedStops, {});
      setStatus(`Stop updated to ${status}.`);
    } catch (error) {
      console.error("Failed to update stop status:", error);
      window.alert("Could not update stop status.");
    }
  }

  function moveStop(fromIndex, toIndex) {
    const route = getActiveRoute();
    if (!route) return;

    const stops = [...(route.stops || [])];
    if (
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= stops.length ||
      toIndex >= stops.length
    ) {
      return;
    }

    const [moved] = stops.splice(fromIndex, 1);
    stops.splice(toIndex, 0, moved);

    updateRouteStops(route, stops);
    setStatus("Stop order updated.");
  }

  async function removeStop(index) {
    const route = getActiveRoute();
    if (!route) return;

    const stops = [...(route.stops || [])];
    const stop = stops[index];
    if (!stop) return;

    const confirmed = window.confirm(
      isCustomStop(stop)
        ? "Remove this custom stop from the route?"
        : "Remove this stop from the route and return it to the dashboard?"
    );
    if (!confirmed) return;

    try {
      if (!isCustomStop(stop)) {
        await postJson("/api/route/update-status", {
          lead_id: getLeadId(stop),
          status: "unrouted",
        });
      }

      stops.splice(index, 1);

      if (!stops.length) {
        const routeId = normalizeString(route?.id);
        removeRouteFromStorage(routeId);
        const nextRoute = getActiveRoute();
        if (nextRoute) {
          renderRoute(nextRoute);
        } else {
          window.location.href = "./dispatch.html";
        }
        return;
      }

      updateRouteStops(route, stops);
      setStatus("Stop removed from route.");
    } catch (error) {
      console.error("Failed to remove stop:", error);
      window.alert("Could not remove this stop.");
    }
  }

  function getDistanceBetween(a, b) {
    const lat1 = Number(a?.lat);
    const lng1 = Number(a?.lng);
    const lat2 = Number(b?.lat);
    const lng2 = Number(b?.lng);

    if (!isValidCoordPair(lat1, lng1) || !isValidCoordPair(lat2, lng2)) {
      return Number.POSITIVE_INFINITY;
    }

    const dx = lat1 - lat2;
    const dy = lng1 - lng2;
    return Math.sqrt(dx * dx + dy * dy);
  }

  async function ensureStopsHaveCoordinates(stops) {
    const updated = [];

    for (const stop of stops) {
      if (hasCoordinates(stop)) {
        updated.push(stop);
        continue;
      }

      const address = getLeadAddress(stop);
      if (!address) {
        updated.push(stop);
        continue;
      }

      const geocoded = await geocodeAddress(address);
      if (!geocoded) {
        updated.push(stop);
        continue;
      }

      updated.push({
        ...stop,
        full_address: address || geocoded.address,
        property_address: normalizeString(stop?.property_address) || address,
        lat: geocoded.lat,
        lng: geocoded.lng,
      });
    }

    return updated;
  }

  async function reoptimizeCurrentRoute() {
    const route = getActiveRoute();
    if (!route) return;

    const stops = await ensureStopsHaveCoordinates(route.stops || []);
    if (!stops.length) return;

    const start = getRouteStartPoint({
      ...route,
      stops,
    });

    const withCoords = stops.filter(hasCoordinates);
    const withoutCoords = stops.filter((stop) => !hasCoordinates(stop));

    if (!withCoords.length) {
      updateRouteStops(route, stops);
      setStatus("Route saved, but there were not enough coordinates to reoptimize order.");
      return;
    }

    const remaining = [...withCoords];
    const ordered = [];
    let currentPoint = {
      lat: start.lat,
      lng: start.lng,
    };

    while (remaining.length) {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;

      remaining.forEach((stop, index) => {
        const distance = getDistanceBetween(currentPoint, {
          lat: getLat(stop),
          lng: getLng(stop),
        });
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });

      const [nextStop] = remaining.splice(bestIndex, 1);
      ordered.push(nextStop);
      currentPoint = {
        lat: getLat(nextStop),
        lng: getLng(nextStop),
      };
    }

    const nextStops = [...ordered, ...withoutCoords];
    updateRouteStops(route, nextStops);
    setStatus("Route reoptimized.");
  }

  async function addCustomStop(insertAtIndex = null) {
    const route = getActiveRoute();
    if (!route) return;

    const address = window.prompt("Enter the stop address:");
    const cleanAddress = normalizeString(address);
    if (!cleanAddress) return;

    let geocoded = await geocodeAddress(cleanAddress);

    const newStop = {
      custom_id: `custom_stop_${Date.now()}`,
      is_custom: true,
      full_address: geocoded?.address || cleanAddress,
      property_address: geocoded?.address || cleanAddress,
      city: "",
      province: "",
      postal_code: "",
      service_type: "Custom stop",
      priority: "Custom",
      preferred_time: "",
      route_status: "routed",
      lat: geocoded?.lat ?? null,
      lng: geocoded?.lng ?? null,
    };

    const stops = [...(route.stops || [])];
    const insertIndex =
      Number.isInteger(insertAtIndex) && insertAtIndex >= 0 && insertAtIndex <= stops.length
        ? insertAtIndex
        : stops.length;

    stops.splice(insertIndex, 0, newStop);
    updateRouteStops(route, stops);
    setStatus("Custom stop added.");
  }

  async function deleteRoute() {
    const route = getActiveRoute();
    const routeId = normalizeString(route?.id);

    if (!routeId) {
      removeRouteFromStorage(routeId);
      renderEmpty();
      return;
    }

    const confirmed = window.confirm(
      "Delete this route and return all routed jobs back to the dashboard?"
    );
    if (!confirmed) return;

    try {
      await postJson("/api/route/delete", { route_id: routeId });
      removeRouteFromStorage(routeId);

      const nextRoute = getActiveRoute();
      if (nextRoute) {
        renderRoute(nextRoute);
      } else {
        window.location.href = "./dispatch.html";
      }
    } catch (error) {
      console.error("Failed to delete route:", error);
      setStatus("Could not delete route. Please try again.");
      window.alert("Failed to delete route and restore jobs.");
    }
  }

  function bindEvents() {
    if (els.backToDashboardBtn) {
      els.backToDashboardBtn.addEventListener("click", function () {
        window.location.href = "./dispatch.html";
      });
    }

    if (els.refreshRouteBtn) {
      els.refreshRouteBtn.addEventListener("click", function () {
        init();
      });
    }

    if (els.deleteRouteBtn) {
      els.deleteRouteBtn.addEventListener("click", deleteRoute);
    }

    if (els.addStopBtn) {
      els.addStopBtn.addEventListener("click", async function () {
        await addCustomStop();
      });
    }

    if (els.reoptimizeRouteBtn) {
      els.reoptimizeRouteBtn.addEventListener("click", async function () {
        await reoptimizeCurrentRoute();
      });
    }

    if (els.openFullRouteBtn) {
      els.openFullRouteBtn.addEventListener("click", function () {
        const route = getActiveRoute();
        const url = buildGoogleMapsDirectionsUrl(route);

        if (!url) {
          window.alert("Could not build Google Maps route.");
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
      });
    }

    if (els.routeSelector) {
      els.routeSelector.addEventListener("change", function () {
        const routeId = normalizeString(els.routeSelector.value);
        if (!routeId) return;

        setActiveRouteId(routeId);
        const route = getActiveRoute();

        if (!route) {
          renderEmpty();
          return;
        }

        renderRoute(route);
      });
    }

    window.addEventListener("resize", invalidateAndRefitMap);
    window.addEventListener("orientationchange", invalidateAndRefitMap);
    window.addEventListener("pageshow", invalidateAndRefitMap);
  }

  function init() {
    renderRouteSelector();

    const route = getActiveRoute();
    if (!route) {
      renderEmpty();
      return;
    }

    renderRoute(route);
  }

  bindEvents();
  init();
})();
