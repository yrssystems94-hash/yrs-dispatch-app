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
    routeVisual: document.getElementById("routeVisual"),
    stopsList: document.getElementById("stopsList"),
    statusBar: document.getElementById("statusBar"),
    routeSelector: document.getElementById("routeSelector"),
  };

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
    if (els.routeVisual) {
      els.routeVisual.innerHTML = `
        <div class="empty-state">
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

    setStatus("No active route loaded.");
  }

  function buildVisualNodes(route) {
    const stops = Array.isArray(route?.stops) ? route.stops : [];
    const startAddress = normalizeString(route?.startAddress);

    if (!stops.length) {
      return `
        <div class="empty-state">
          No stops to display.
        </div>
      `;
    }

    const width = 100;
    const height = 100;

    const nodes = [
      {
        type: "start",
        label: "Start",
        address: startAddress || "Starting point not set",
        x: 10,
        y: 50,
      },
      ...stops.map((lead, index) => {
        const x = Math.min(90, 24 + index * 17);
        const y = index % 2 === 0 ? 28 : 72;

        return {
          type: "stop",
          label: `Stop ${index + 1}`,
          address: getLeadAddress(lead),
          meta: `${formatDisplay(lead?.service_type)} • ${formatDisplay(
            lead?.priority
          )}`,
          badge: getBadgeText(lead),
          x,
          y,
        };
      }),
    ];

    const lineSegments = [];

    for (let i = 0; i < nodes.length - 1; i += 1) {
      const a = nodes[i];
      const b = nodes[i + 1];

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

      lineSegments.push(`
        <div
          style="
            position:absolute;
            left:${a.x}%;
            top:${a.y}%;
            width:${length}%;
            height:3px;
            background:#93a8c5;
            transform-origin:left center;
            transform:rotate(${angle}deg);
            border-radius:999px;
          "
        ></div>
      `);
    }

    const nodeHtml = nodes
      .map((node, index) => {
        const badgeClass =
          node.type === "start"
            ? "start-badge"
            : node.badge && ["Urgent", "Emergency"].includes(node.badge)
            ? "urgent"
            : "";

        return `
          <div
            class="route-node ${node.type === "start" ? "start" : ""}"
            style="
              position:absolute;
              left:${node.x}%;
              top:${node.y}%;
              transform:translate(-50%, -50%);
              max-width:170px;
              min-width:120px;
              z-index:${20 + index};
            "
          >
            <div class="route-node-label">${escapeHtml(node.label)}</div>
            <div class="route-node-address">${escapeHtml(node.address)}</div>
            ${
              node.meta
                ? `<div class="route-node-meta">${escapeHtml(node.meta)}</div>`
                : ""
            }
            ${
              node.badge
                ? `<div class="badge ${escapeHtml(badgeClass)}">${escapeHtml(
                    node.badge
                  )}</div>`
                : ""
            }
          </div>
        `;
      })
      .join("");

    return `
      <div style="position:relative; width:100%; min-height:360px; background:#eef4ff; border-radius:16px; overflow:hidden;">
        ${lineSegments.join("")}
        ${nodeHtml}
      </div>
    `;
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
        return `<option value="${escapeHtml(route.id)}" ${selected}>${escapeHtml(
          label
        )}</option>`;
      })
      .join("");
  }

  function renderRoute(route) {
    const stops = Array.isArray(route?.stops) ? route.stops : [];

    if (!stops.length) {
      renderEmpty();
      return;
    }

    if (els.routeVisual) {
      els.routeVisual.innerHTML = buildVisualNodes(route);
    }

    if (els.stopsList) {
      els.stopsList.innerHTML = stops
        .map((lead, index) => {
          const address = getLeadAddress(lead);
          const serviceType = formatDisplay(lead?.service_type);
          const priority = formatDisplay(lead?.priority);
          const preferredTime = formatDisplay(lead?.preferred_time);
          const phone = formatDisplay(lead?.phone, "");
          const routeStatus = normalizeString(lead?.route_status || "routed");
          const groupedCount = Number(lead?.grouped_count || 1);
          const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            address
          )}`;

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
                Current Status: ${escapeHtml(routeStatus)}
              </div>

              <div class="stop-actions">
                <button class="btn btn-success" type="button" data-phone="${escapeHtml(
                  phone
                )}">Call</button>
                <button class="btn btn-primary" type="button" data-map="${escapeHtml(
                  mapsUrl
                )}">Map</button>
                <button class="btn btn-secondary" type="button" data-arrived="${escapeHtml(
                  getLeadId(lead)
                )}">Arrived</button>
                <button class="btn btn-dark" type="button" data-done="${escapeHtml(
                  getLeadId(lead)
                )}">Done</button>
              </div>
            </div>
          `;
        })
        .join("");

      Array.from(els.stopsList.querySelectorAll("[data-phone]")).forEach((btn) => {
        btn.addEventListener("click", function () {
          const phone = normalizeString(btn.getAttribute("data-phone"));
          if (!phone) {
            window.alert("No phone number available for this stop.");
            return;
          }
          window.location.href = `tel:${phone}`;
        });
      });

      Array.from(els.stopsList.querySelectorAll("[data-map]")).forEach((btn) => {
        btn.addEventListener("click", function () {
          const mapUrl = normalizeString(btn.getAttribute("data-map"));
          if (!mapUrl) return;
          window.open(mapUrl, "_blank", "noopener,noreferrer");
        });
      });

      Array.from(els.stopsList.querySelectorAll("[data-arrived]")).forEach((btn) => {
        btn.addEventListener("click", async function () {
          const leadId = normalizeString(btn.getAttribute("data-arrived"));
          if (!leadId) return;
          await markStopStatus(leadId, "arrived");
        });
      });

      Array.from(els.stopsList.querySelectorAll("[data-done]")).forEach((btn) => {
        btn.addEventListener("click", async function () {
          const leadId = normalizeString(btn.getAttribute("data-done"));
          if (!leadId) return;
          await markStopStatus(leadId, "done");
        });
      });
    }

    if (els.openFullRouteBtn) {
      els.openFullRouteBtn.disabled = false;
    }

    if (els.deleteRouteBtn) {
      els.deleteRouteBtn.disabled = false;
    }

    renderRouteSelector();

    setStatus(
      `Route loaded: ${stops.length} stop${stops.length === 1 ? "" : "s"}.`
    );
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
