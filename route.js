const ROUTE_CONFIG = {
  apiBaseUrl:
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
      ? "http://localhost:4000"
      : "https://yrs-lead-api.onrender.com",
  activeRouteStorageKey: "yrs_active_route",
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

  function getActiveRoute() {
    try {
      const raw = window.localStorage.getItem(ROUTE_CONFIG.activeRouteStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function clearActiveRoute() {
    window.localStorage.removeItem(ROUTE_CONFIG.activeRouteStorageKey);
  }

  function getLeadId(lead) {
    return normalizeString(lead.lead_id) || normalizeString(lead.id);
  }

  function getLeadAddress(lead) {
    return (
      normalizeString(lead.property_address) ||
      normalizeString(lead.full_address) ||
      [
        normalizeString(lead.property_address),
        normalizeString(lead.city),
        normalizeString(lead.province),
        normalizeString(lead.postal_code),
      ]
        .filter(Boolean)
        .join(", ")
    );
  }

  function getBadgeText(lead) {
    const priority = normalizeString(lead.priority).toLowerCase();
    const serviceType = normalizeString(lead.service_type).toLowerCase();

    if (priority.includes("urgent")) return "Urgent";
    if (serviceType.includes("emergency")) return "Emergency";
    return "Routed";
  }

  function setStatus(message) {
    if (!els.statusBar) return;
    els.statusBar.textContent = message || "";
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

  async function updateRouteStatus(leadIds, routeStatus) {
    const response = await fetch(getApiUrl("/api/update-route-status"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        leadIds,
        route_status: routeStatus,
      }),
    });

    const json = await response.json();

    if (!response.ok || !json || json.success !== true) {
      throw new Error(json?.error || "Failed to update route status");
    }

    return json;
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

    setStatus("No active route loaded.");
  }

  function renderRoute(route) {
    const stops = Array.isArray(route?.stops) ? route.stops : [];
    const startAddress = normalizeString(route?.startAddress);

    if (!stops.length) {
      renderEmpty();
      return;
    }

    if (els.routeVisual) {
      els.routeVisual.innerHTML = `
        <div class="route-node start">
          <div class="route-node-label">Start</div>
          <div class="route-node-address">${escapeHtml(startAddress || "Starting point not set")}</div>
          <div class="route-node-meta">Route beginning</div>
        </div>
        ${stops
          .map((lead, index) => {
            return `
              <div class="route-node">
                <div class="route-node-label">Stop ${index + 1}</div>
                <div class="route-node-address">${escapeHtml(getLeadAddress(lead))}</div>
                <div class="route-node-meta">
                  ${escapeHtml(formatDisplay(lead.service_type))} • ${escapeHtml(formatDisplay(lead.priority))} • ${escapeHtml(formatDisplay(lead.preferred_time))}
                </div>
              </div>
            `;
          })
          .join("")}
      `;
    }

    if (els.stopsList) {
      els.stopsList.innerHTML = stops
        .map((lead, index) => {
          const address = getLeadAddress(lead);
          const serviceType = formatDisplay(lead.service_type);
          const priority = formatDisplay(lead.priority);
          const preferredTime = formatDisplay(lead.preferred_time);
          const phone = formatDisplay(lead.phone, "");
          const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

          return `
            <div class="stop-card">
              <div class="stop-top">
                <div>
                  <div class="stop-number">Stop ${index + 1}</div>
                  <div class="stop-address">${escapeHtml(address)}</div>
                </div>
                <div class="badge">${escapeHtml(getBadgeText(lead))}</div>
              </div>

              <div class="stop-meta">
                ${escapeHtml(serviceType)} • ${escapeHtml(priority)} • ${escapeHtml(preferredTime)}
              </div>

              <div class="stop-actions">
                <button class="btn btn-success" type="button" data-phone="${escapeHtml(phone)}">Call</button>
                <button class="btn btn-primary" type="button" data-map="${escapeHtml(mapsUrl)}">Map</button>
              </div>
            </div>
          `;
        })
        .join("");

      Array.from(els.stopsList.querySelectorAll("[data-phone]")).forEach((btn) => {
        btn.addEventListener("click", function () {
          const phone = normalizeString(btn.getAttribute("data-phone"));
          if (!phone) {
            alert("No phone number available for this stop.");
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
    }

    if (els.openFullRouteBtn) {
      els.openFullRouteBtn.disabled = false;
    }

    if (els.deleteRouteBtn) {
      els.deleteRouteBtn.disabled = false;
    }

    setStatus(`Route loaded: ${stops.length} stop${stops.length === 1 ? "" : "s"}.`);
  }

  async function deleteRoute() {
    const route = getActiveRoute();
    const stops = Array.isArray(route?.stops) ? route.stops : [];

    if (!stops.length) {
      clearActiveRoute();
      renderEmpty();
      return;
    }

    const confirmed = window.confirm(
      "Delete this route and return all routed jobs back to the dashboard?"
    );

    if (!confirmed) return;

    try {
      const leadIds = stops.map(getLeadId).filter(Boolean);
      await updateRouteStatus(leadIds, "unrouted");
      clearActiveRoute();
      window.location.href = "./dispatch.html";
    } catch (error) {
      console.error("Failed to delete route:", error);
      setStatus("Could not delete route. Please try again.");
      alert("Failed to delete route and restore jobs.");
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
          alert("Could not build Google Maps route.");
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
      });
    }
  }

  function init() {
    bindEvents();

    const route = getActiveRoute();
    if (!route) {
      renderEmpty();
      return;
    }

    renderRoute(route);
  }

  init();
})();