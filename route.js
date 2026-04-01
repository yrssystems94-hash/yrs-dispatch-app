const ROUTE_CONFIG = {
  apiBaseUrl:
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
      ? "http://localhost:4000"
      : "https://yrs-lead-api.onrender.com",

  routesStorageKey: "yrs_routes",
  activeRouteIdStorageKey: "yrs_active_route_id",
};

(function () {
  const els = {
    openFullRouteBtn: document.getElementById("openFullRouteBtn"),
    backToDashboardBtn: document.getElementById("backToDashboardBtn"),
    deleteRouteBtn: document.getElementById("deleteRouteBtn"),
    refreshRouteBtn: document.getElementById("refreshRouteBtn"),
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
  let activeMarkersByLeadId = new Map();
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

    if (!activeRouteId) {
      return routes.length ? routes[routes.length - 1] : null;
    }

    return routes.find((route) => normalizeString(route.id) === activeRouteId) || null;
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

  function getLeadAddress(lead) {
    return (
      normalizeString(lead?.property_address) ||
      normalizeString(lead?.full_address) ||
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

  function hasCoordinates(lead) {
    return getLat(lead) !== null && getLng(lead) !== null;
  }

  function getRouteStartPoint(route) {
    const startLat = Number(route?.startLat);
    const startLng = Number(route?.startLng);

    if (Number.isFinite(startLat) && Number.isFinite(startLng)) {
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
      lat: null,
      lng: null,
      address: normalizeString(route?.startAddress),
      source: "none",
    };
  }

  function isUrgentStop(lead) {
    const routeStatus = normalizeString(lead?.route_status).toLowerCase();
    const priority = normalizeString(lead?.priority).toLowerCase();
    const serviceType = normalizeString(lead?.service_type).toLowerCase();

    if (routeStatus === "done" || routeStatus === "arrived") {
      return false;
    }

    return (
      priority.includes("urgent") ||
      priority.includes("emergency") ||
      serviceType.includes("emergency") ||
      serviceType.includes("leak")
    );
  }

  function getBadgeText(lead) {
    const routeStatus = normalizeString(lead?.route_status).toLowerCase();
    const priority = normalizeString(lead?.priority).toLowerCase();
    const serviceType = normalizeString(lead?.service_type).toLowerCase();

    if (routeStatus === "done") return "Done";
    if (routeStatus === "arrived") return "Arrived";
    if (priority.includes("urgent")) return "Urgent";
    if (serviceType.includes("emergency") || serviceType.includes("leak")) {
      return "Emergency";
    }

    return "Routed";
  }

  function getBadgeClass(lead) {
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
      throw new Error(json?.error || `POST failed: ${path}`);
    }

    return json;
  }

  function buildGoogleMapsDirectionsUrl(route) {
    const stops = Array.isArray(route?.stops) ? route.stops : [];
    const startAddress = normalizeString(route?.startAddress);

    if (!stops.length) return "";

    const addresses = stops.map(getLeadAddress).filter(Boolean);
    if (!addresses.length) return "";

    const origin = startAddress || addresses[0];
    const destination = addresses[addresses.length - 1];
    const waypoints = addresses.slice(0, -1);

    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", origin);
    url.searchParams.set("destination", destination);

    if (waypoints.length) {
      url.searchParams.set("waypoints", waypoints.join("|"));
    }

    return url.toString();
  }

  function renderEmpty() {
    if (els.routeMap) {
      els.routeMap.innerHTML = `
        <div class="map-fallback">
          No active route found. Go back to the dashboard and optimize a route first.
        </div>
      `;
    }

    if (els.stopsList) {
      els.stopsList.innerHTML = "";
    }

    if (els.openFullRouteBtn) {
      els.openFullRouteBtn.disabled = true;
    }

    if (els.deleteRouteBtn) {
      els.deleteRouteBtn.disabled = true;
    }

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
    activeMarkersByLeadId = new Map();
    fallbackMessageRendered = false;

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

  function focusStopByLeadId(leadId) {
    const marker = activeMarkersByLeadId.get(normalizeString(leadId));
    if (!marker || !map) return;

    const latLng = marker.getLatLng();
    map.flyTo(latLng, Math.max(map.getZoom(), 14), {
      animate: true,
      duration: 0.6,
    });

    marker.openPopup();

    Array.from(document.querySelectorAll(".stop-card")).forEach((card) => {
      const cardLeadId = normalizeString(card.getAttribute("data-lead-id"));
      card.classList.toggle("active", cardLeadId === normalizeString(leadId));
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

  function renderRouteStats(route) {
    const stops = Array.isArray(route?.stops) ? route.stops : [];
    const urgentCount = stops.filter(isUrgentStop).length;
    const doneCount = stops.filter(
      (stop) => normalizeString(stop?.route_status).toLowerCase() === "done"
    ).length;
    const groupedCount = stops.filter((stop) => Number(stop?.grouped_count || 1) > 1).length;
    const routeType = normalizeString(route?.type || "standard");
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
        `${stops.length} Stop${stops.length === 1 ? "" : "s"}`,
        `${urgentCount} Urgent`,
        `${doneCount} Done`,
        groupedCount ? `${groupedCount} Multi-job Stop${groupedCount === 1 ? "" : "s"}` : null,
        cityList.length ? cityList.join(" / ") : null,
      ].filter(Boolean);

      els.routeStats.innerHTML = chips
        .map((chip) => `<div class="stat-chip">${escapeHtml(chip)}</div>`)
        .join("");
    }
  }

  function renderMap(route) {
    const stops = Array.isArray(route?.stops) ? route.stops : [];
    const startPoint = getRouteStartPoint(route);
    const m = initMapIfNeeded();

    if (!m) return;

    activeMarkersByLeadId = new Map();

    if (markerLayer) {
      markerLayer.clearLayers();
    }

    if (routePolyline) {
      routePolyline.remove();
      routePolyline = null;
    }

    const stopsWithCoords = stops.filter(hasCoordinates);
    const boundsPoints = [];
    const linePoints = [];

    if (!stopsWithCoords.length) {
      destroyMap();
      if (els.routeMap && !fallbackMessageRendered) {
        els.routeMap.innerHTML = `
          <div class="map-fallback">
            This route does not have enough map coordinates yet to render a live local-area map.
            The stops are still listed below and the Google Maps route button will still work.
          </div>
        `;
        fallbackMessageRendered = true;
      }

      if (els.mapNote) {
        els.mapNote.textContent =
          "No map pins available yet because these stops are missing coordinates.";
      }
      return;
    }

    if (startPoint.lat !== null && startPoint.lng !== null) {
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
      const leadId = getLeadId(lead);

      linePoints.push([lat, lng]);
      boundsPoints.push([lat, lng]);

      const popupHtml = `
        <strong>Stop ${index + 1}</strong><br>
        ${escapeHtml(getLeadAddress(lead))}<br>
        ${escapeHtml(formatDisplay(lead?.service_type))} • ${escapeHtml(getBadgeText(lead))}
      `;

      const marker = L.marker([lat, lng], {
        icon: createStopIcon(index, lead),
      }).bindPopup(popupHtml);

      marker.on("click", function () {
        focusStopByLeadId(leadId);
      });

      markerLayer.addLayer(marker);
      activeMarkersByLeadId.set(leadId, marker);
    });

    const polylinePoints =
      startPoint.lat !== null && startPoint.lng !== null
        ? [[startPoint.lat, startPoint.lng], ...linePoints]
        : linePoints;

    if (polylinePoints.length >= 2) {
      routePolyline = L.polyline(polylinePoints, {
        color: "#2f7cf6",
        weight: 5,
        opacity: 0.78,
        lineJoin: "round",
      }).addTo(m);
    }

    if (boundsPoints.length === 1) {
      m.setView(boundsPoints[0], 14);
    } else {
      m.fitBounds(boundsPoints, { padding: [30, 30] });
    }

    if (els.mapNote) {
      const startSourceText =
        startPoint.source === "home" || startPoint.source === "home_fallback"
          ? "Starting at home address."
          : startPoint.source === "first_selected"
          ? "Starting at the first selected address."
          : startPoint.source === "first_stop_fallback"
          ? "Custom start could not be mapped, so the view is anchored to the first stop area."
          : "Starting with your saved route start.";

      els.mapNote.textContent = `${stopsWithCoords.length} mapped stop${
        stopsWithCoords.length === 1 ? "" : "s"
      } rendered. ${startSourceText}`;
    }
  }

  function renderStops(route) {
    const stops = Array.isArray(route?.stops) ? route.stops : [];

    if (!stops.length) {
      if (els.stopsList) {
        els.stopsList.innerHTML = `
          <div class="empty-state">
            No stops found for this route.
          </div>
        `;
      }
      return;
    }

    if (!els.stopsList) return;

    els.stopsList.innerHTML = stops
      .map((lead, index) => {
        const address = getLeadAddress(lead);
        const serviceType = formatDisplay(lead?.service_type);
        const priority = formatDisplay(lead?.priority);
        const preferredTime = formatDisplay(lead?.preferred_time);
        const phone = formatDisplay(lead?.phone, "");
        const routeStatus = normalizeString(lead?.route_status || "routed");
        const groupedCount = Number(lead?.grouped_count || 1);
        const hasMap = hasCoordinates(lead) || Boolean(address);
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

        return `
          <div class="stop-card" data-lead-id="${escapeHtml(getLeadId(lead))}">
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
              ${escapeHtml(serviceType)} • ${escapeHtml(priority)} • ${escapeHtml(
                preferredTime
              )}${groupedCount > 1 ? ` • ${escapeHtml(String(groupedCount))} jobs here` : ""}
            </div>

            <div class="stop-meta">
              Current Status: ${escapeHtml(routeStatus || "routed")}
            </div>

            <div class="stop-actions">
              <button class="btn btn-success" type="button" data-phone="${escapeHtml(phone)}">Call</button>
              <button class="btn btn-primary" type="button" data-map="${escapeHtml(mapsUrl)}" ${
                hasMap ? "" : "disabled"
              }>Map</button>
              <button class="btn btn-dark" type="button" data-arrived="${escapeHtml(
                getLeadId(lead)
              )}">Arrived</button>
              <button class="btn btn-danger" type="button" data-done="${escapeHtml(
                getLeadId(lead)
              )}">Done</button>
            </div>
          </div>
        `;
      })
      .join("");

    Array.from(els.stopsList.querySelectorAll(".stop-card")).forEach((card) => {
      card.addEventListener("click", function () {
        const leadId = normalizeString(card.getAttribute("data-lead-id"));
        if (!leadId) return;
        focusStopByLeadId(leadId);
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
  }

  function renderRoute(route) {
    const stops = Array.isArray(route?.stops) ? route.stops : [];

    if (!stops.length) {
      renderEmpty();
      return;
    }

    if (els.openFullRouteBtn) {
      els.openFullRouteBtn.disabled = false;
    }

    if (els.deleteRouteBtn) {
      els.deleteRouteBtn.disabled = false;
    }

    renderRouteSelector();
    renderRouteStats(route);
    renderMap(route);
    renderStops(route);

    setStatus(`Route loaded: ${stops.length} stop${stops.length === 1 ? "" : "s"}.`);
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
        return {
          ...stop,
          route_status: status,
        };
      });

      const routes = getRoutes().map((item) => {
        if (normalizeString(item.id) !== normalizeString(route.id)) return item;
        return {
          ...item,
          stops: updatedStops,
        };
      });

      setRoutes(routes);
      renderRoute({
        ...route,
        stops: updatedStops,
      });

      setStatus(`Stop updated to ${status}.`);
    } catch (error) {
      console.error("Failed to update stop status:", error);
      window.alert("Could not update stop status.");
    }
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
      await postJson("/api/route/delete", {
        route_id: routeId,
      });

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
  }

  function init() {
    bindEvents();
    renderRouteSelector();

    const route = getActiveRoute();
    if (!route) {
      renderEmpty();
      return;
    }

    renderRoute(route);
  }

  init();
})();
