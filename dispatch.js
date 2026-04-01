const DISPATCH_CONFIG = {
  apiBaseUrl:
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
      ? "http://localhost:4000"
      : "https://yrs-lead-api.onrender.com",

  defaultStartAddress: "10 Carlyle Pl, Kitchener, ON N2P 1R6",
  defaultStartLat: 43.4057,
  defaultStartLng: -80.4446,

  routesStorageKey: "yrs_routes",
  activeRouteIdStorageKey: "yrs_active_route_id",
  maxSavedRoutes: 5,
};

(function () {
  const els = {
    refreshBtn: document.getElementById("refreshBtn"),
    showAllBtn: document.getElementById("showAllBtn"),
    clearFilterBtn: document.getElementById("clearFilterBtn"),
    optimizeBtn: document.getElementById("optimizeBtn"),
    emergencyOptimizeBtn: document.getElementById("emergencyOptimizeBtn"),
    batchDeleteBtn: document.getElementById("batchDeleteBtn"),
    resumeRouteBtn: document.getElementById("resumeRouteBtn"),
    startModeSelect: document.getElementById("startModeSelect"),
    customStartInput: document.getElementById("customStartInput"),
    endModeSelect: document.getElementById("endModeSelect"),
    routeDaySelect: document.getElementById("routeDaySelect"),
    statusBar: document.getElementById("statusBar"),
    panelTitle: document.getElementById("panelTitle"),
    panelSubtitle: document.getElementById("panelSubtitle"),
    leadList: document.getElementById("leadList"),
    routeOutput: document.getElementById("routeOutput"),
    errorBox: document.getElementById("errorBox"),
    selectionNote: document.getElementById("selectionNote"),
    urgentCount: document.getElementById("urgentCount"),
    todayCount: document.getElementById("todayCount"),
    overdueCount: document.getElementById("overdueCount"),
    unroutedCount: document.getElementById("unroutedCount"),
    filterCards: Array.from(document.querySelectorAll("[data-filter]")),
  };

  const state = {
    isLoadingCounts: false,
    isLoadingLeads: false,
    activeFilter: null,
    allLeads: [],
    selectedLeadIds: [],
    optimizedRoute: [],
    customStartPlace: null,
  };

  function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function formatDisplay(value, fallback = "N/A") {
    const text = normalizeString(String(value || ""));
    return text || fallback;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uniqueStrings(values) {
    return Array.from(
      new Set(
        (Array.isArray(values) ? values : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    );
  }

  function getApiUrl(path) {
    return `${DISPATCH_CONFIG.apiBaseUrl}${path}`;
  }

  function getLeadId(lead) {
    return normalizeString(lead?.lead_id) || normalizeString(lead?.id);
  }

  function getLeadDbId(lead) {
    return normalizeString(lead?.id);
  }

  function getLeadBusinessId(lead) {
    return normalizeString(lead?.lead_id);
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

  function getLeadPhone(lead) {
    return normalizeString(lead?.phone);
  }

  function getLeadLat(lead) {
    const lat = Number(lead?.lat);
    return Number.isFinite(lat) ? lat : null;
  }

  function getLeadLng(lead) {
    const lng = Number(lead?.lng);
    return Number.isFinite(lng) ? lng : null;
  }

  function getLeadTimestamp(lead) {
    const raw =
      normalizeString(lead?.received_at) ||
      normalizeString(lead?.submitted_at) ||
      "";

    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatLeadReceivedDate(lead) {
    const date = getLeadTimestamp(lead);
    if (!date) return "Unknown received time";

    return date.toLocaleString("en-CA", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function getLeadDayKey(lead) {
    const date = getLeadTimestamp(lead);
    if (!date) return "unknown";
    return date.toISOString().slice(0, 10);
  }

  function getLeadDayLabelFromKey(key) {
    if (key === "unknown") return "Unknown Date";
    const date = new Date(`${key}T00:00:00`);
    if (Number.isNaN(date.getTime())) return key;

    return date.toLocaleDateString("en-CA", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }

  function buildRouteDayOptions() {
    if (!els.routeDaySelect) return;

    const options = [];
    for (let i = 0; i < 5; i += 1) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      const value = date.toISOString().slice(0, 10);
      const label =
        i === 0
          ? `Today - ${date.toLocaleDateString("en-CA", {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}`
          : date.toLocaleDateString("en-CA", {
              weekday: "long",
              month: "short",
              day: "numeric",
            });

      options.push(
        `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`
      );
    }

    els.routeDaySelect.innerHTML = options.join("");
  }

  function sortLeadsByReceivedFirst(leads) {
    return [...(Array.isArray(leads) ? leads : [])].sort((a, b) => {
      const aDate = getLeadTimestamp(a);
      const bDate = getLeadTimestamp(b);

      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;

      const timeDiff = aDate.getTime() - bDate.getTime();
      if (timeDiff !== 0) return timeDiff;

      const aId = getLeadId(a);
      const bId = getLeadId(b);
      return aId.localeCompare(bId);
    });
  }

  function groupLeadsByReceivedDay(leads) {
    const sorted = sortLeadsByReceivedFirst(leads);
    const groups = new Map();

    sorted.forEach((lead) => {
      const dayKey = getLeadDayKey(lead);
      if (!groups.has(dayKey)) groups.set(dayKey, []);
      groups.get(dayKey).push(lead);
    });

    return Array.from(groups.entries()).map(([dayKey, items]) => ({
      dayKey,
      dayLabel: getLeadDayLabelFromKey(dayKey),
      items,
    }));
  }

  function normalizeAddress(address) {
    return normalizeString(address)
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/,/g, "")
      .replace(/\s+/g, " ")
      .replace(/\bstreet\b/g, "st")
      .replace(/\bavenue\b/g, "ave")
      .replace(/\broad\b/g, "rd")
      .replace(/\bdrive\b/g, "dr")
      .replace(/\blane\b/g, "ln")
      .replace(/\bcourt\b/g, "crt")
      .replace(/\bplace\b/g, "pl")
      .trim();
  }

  function getRoutes() {
    try {
      const raw = window.localStorage.getItem(DISPATCH_CONFIG.routesStorageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function setRoutes(routes) {
    window.localStorage.setItem(
      DISPATCH_CONFIG.routesStorageKey,
      JSON.stringify(Array.isArray(routes) ? routes : [])
    );
  }

  function getActiveRouteId() {
    return normalizeString(
      window.localStorage.getItem(DISPATCH_CONFIG.activeRouteIdStorageKey)
    );
  }

  function setActiveRouteId(routeId) {
    window.localStorage.setItem(
      DISPATCH_CONFIG.activeRouteIdStorageKey,
      normalizeString(routeId)
    );
  }

  function clearActiveRouteId() {
    window.localStorage.removeItem(DISPATCH_CONFIG.activeRouteIdStorageKey);
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

  function updateResumeRouteButton() {
    if (!els.resumeRouteBtn) return;
    els.resumeRouteBtn.hidden = getRoutes().length === 0;
  }

  function getStartMode() {
    return normalizeString(els.startModeSelect?.value) || "home";
  }

  function getEndMode() {
    return normalizeString(els.endModeSelect?.value) || "last";
  }

  function getPlannedDay() {
    return (
      normalizeString(els.routeDaySelect?.value) ||
      new Date().toISOString().slice(0, 10)
    );
  }

  function getHomeStartCoords() {
    const lat = Number(DISPATCH_CONFIG.defaultStartLat);
    const lng = Number(DISPATCH_CONFIG.defaultStartLng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { lat: null, lng: null };
    }

    return { lat, lng };
  }

  function getSelectedLeadsInCurrentOrder() {
    return state.allLeads.filter((lead) =>
      state.selectedLeadIds.includes(getLeadId(lead))
    );
  }

  function getStartAddressFromSelectedFirst() {
    const selectedLeads = getSelectedLeadsInCurrentOrder();
    if (!selectedLeads.length) return "";
    return getLeadAddress(selectedLeads[0]);
  }

  function getStartAddress() {
    const mode = getStartMode();

    if (mode === "custom") {
      const custom = normalizeString(els.customStartInput?.value);
      return custom || DISPATCH_CONFIG.defaultStartAddress;
    }

    if (mode === "first") {
      return getStartAddressFromSelectedFirst() || DISPATCH_CONFIG.defaultStartAddress;
    }

    return DISPATCH_CONFIG.defaultStartAddress;
  }

  async function resolveStartLocation() {
    const mode = getStartMode();

    if (mode === "home") {
      const coords = getHomeStartCoords();
      return {
        address: DISPATCH_CONFIG.defaultStartAddress,
        lat: coords.lat,
        lng: coords.lng,
        source: "home",
      };
    }

    if (mode === "first") {
      const selectedLeads = getSelectedLeadsInCurrentOrder();
      const firstLead = selectedLeads[0] || null;

      if (firstLead) {
        return {
          address: getLeadAddress(firstLead) || DISPATCH_CONFIG.defaultStartAddress,
          lat: getLeadLat(firstLead),
          lng: getLeadLng(firstLead),
          source: "first_selected",
        };
      }

      const coords = getHomeStartCoords();
      return {
        address: DISPATCH_CONFIG.defaultStartAddress,
        lat: coords.lat,
        lng: coords.lng,
        source: "home_fallback",
      };
    }

    if (state.customStartPlace) {
      return {
        address:
          state.customStartPlace.address || getStartAddress() || DISPATCH_CONFIG.defaultStartAddress,
        lat: state.customStartPlace.lat,
        lng: state.customStartPlace.lng,
        source: "custom_place",
      };
    }

    return {
      address: getStartAddress(),
      lat: null,
      lng: null,
      source: "custom_unresolved",
    };
  }

  function updateStartInputUi() {
    if (!els.startModeSelect || !els.customStartInput) return;
    els.customStartInput.hidden =
      normalizeString(els.startModeSelect.value) !== "custom";
  }

  function initCustomStartAutocomplete() {
    if (!els.customStartInput) return;
    if (!window.google || !window.google.maps || !window.google.maps.places) return;

    const autocomplete = new window.google.maps.places.Autocomplete(
      els.customStartInput,
      {
        fields: ["formatted_address", "geometry", "name"],
        componentRestrictions: { country: "ca" },
      }
    );

    autocomplete.addListener("place_changed", function () {
      const place = autocomplete.getPlace();
      const address =
        place?.formatted_address ||
        place?.name ||
        normalizeString(els.customStartInput.value);

      let lat = null;
      let lng = null;

      if (place?.geometry?.location) {
        lat = Number(place.geometry.location.lat());
        lng = Number(place.geometry.location.lng());
      }

      state.customStartPlace = {
        address,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
      };

      els.customStartInput.value = address || els.customStartInput.value;
    });

    els.customStartInput.addEventListener("input", function () {
      state.customStartPlace = null;
    });
  }

  function setStatus(message) {
    if (!els.statusBar) return;
    els.statusBar.textContent = message || "";
  }

  function setError(message) {
    if (!els.errorBox) return;

    if (!message) {
      els.errorBox.hidden = true;
      els.errorBox.textContent = "";
      return;
    }

    els.errorBox.hidden = false;
    els.errorBox.textContent = message;
  }

  function setLoadingButtons() {
    const busy = state.isLoadingCounts || state.isLoadingLeads;

    [els.refreshBtn, els.optimizeBtn, els.emergencyOptimizeBtn, els.batchDeleteBtn].forEach(
      (btn) => {
        if (!btn) return;
        btn.disabled = busy;
      }
    );

    if (els.refreshBtn) els.refreshBtn.textContent = busy ? "Loading..." : "Refresh";
    if (els.optimizeBtn)
      els.optimizeBtn.textContent = busy ? "Loading..." : "Optimize Route";
    if (els.emergencyOptimizeBtn)
      els.emergencyOptimizeBtn.textContent = busy
        ? "Loading..."
        : "Emergency Optimize";
    if (els.batchDeleteBtn)
      els.batchDeleteBtn.textContent = busy ? "Loading..." : "Delete Selected";
  }

  function getFilterQuery(filterKey) {
    switch (filterKey) {
      case "urgent":
        return "urgent=true";
      case "today":
        return "today=true";
      case "overdue":
        return "overdue=true";
      case "unrouted":
        return "route_status=unrouted";
      default:
        return "";
    }
  }

  function getFilterTitle(filterKey) {
    switch (filterKey) {
      case "urgent":
        return "Urgent Leads";
      case "today":
        return "Today Leads";
      case "overdue":
        return "Overdue Leads";
      case "unrouted":
        return "Unrouted Leads";
      default:
        return "Incoming Leads";
    }
  }

  function getFilterSubtitle(filterKey) {
    switch (filterKey) {
      case "urgent":
        return "Only urgent jobs, grouped by day received.";
      case "today":
        return "Jobs assigned or due today.";
      case "overdue":
        return "Older jobs still needing action.";
      case "unrouted":
        return "Dispatch-ready leads not yet routed.";
      default:
        return "Grouped by day received, then ordered by time received first.";
    }
  }

  function setActiveFilterUi(filterKey) {
    state.activeFilter = filterKey || null;

    els.filterCards.forEach((card) => {
      const isActive = card.dataset.filter === state.activeFilter;
      card.style.outline = isActive ? "3px solid #14212f" : "none";
      card.style.outlineOffset = isActive ? "2px" : "0";
    });

    if (els.showAllBtn)
      els.showAllBtn.classList.toggle("active", !state.activeFilter);
    if (els.clearFilterBtn)
      els.clearFilterBtn.classList.toggle("active", Boolean(state.activeFilter));
    if (els.panelTitle) els.panelTitle.textContent = getFilterTitle(state.activeFilter);
    if (els.panelSubtitle)
      els.panelSubtitle.textContent = getFilterSubtitle(state.activeFilter);
  }

  async function fetchJson(path) {
    const response = await fetch(getApiUrl(path), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const json = await response.json();

    if (!json || json.success !== true) {
      throw new Error(json?.error || "Request did not return success");
    }

    return json;
  }

  async function postJson(path, body) {
    const response = await fetch(getApiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });

    const json = await response.json().catch(() => null);

    if (!response.ok || !json || json.success !== true) {
      throw new Error(
        json?.details || json?.error || json?.message || `POST failed: ${path}`
      );
    }

    return json;
  }

  function renderEmptyState(message) {
    if (!els.leadList) return;
    els.leadList.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  }

  function renderLoadingState() {
    if (!els.leadList) return;
    els.leadList.innerHTML = `<div class="loading">Loading leads...</div>`;
  }

  function renderRouteEmptyState(message) {
    if (!els.routeOutput) return;
    els.routeOutput.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  }

  function updateSelectionNote() {
    if (!els.selectionNote) return;

    const count = state.selectedLeadIds.length;
    const routesCount = getRoutes().length;

    if (count === 0) {
      els.selectionNote.textContent =
        routesCount > 0
          ? `Select jobs first, then optimize your route. You currently have ${routesCount} planned route${routesCount === 1 ? "" : "s"} saved.`
          : "Select jobs first, then optimize your route.";
      return;
    }

    els.selectionNote.textContent = `${count} job${count === 1 ? "" : "s"} selected.`;
  }

  function isSelectedLead(lead) {
    return state.selectedLeadIds.includes(getLeadId(lead));
  }

  function isLeadUrgent(lead) {
    const priority = normalizeString(lead?.priority).toLowerCase();
    const serviceType = normalizeString(lead?.service_type).toLowerCase();
    const details = normalizeString(lead?.details).toLowerCase();

    return (
      priority.includes("urgent") ||
      priority.includes("emergency") ||
      priority.includes("asap") ||
      priority.includes("high") ||
      serviceType.includes("emergency") ||
      serviceType.includes("leak") ||
      details.includes("leak") ||
      details.includes("urgent")
    );
  }

  function isLeadOverdue(lead) {
    const submittedAt =
      normalizeString(lead?.submitted_at) || normalizeString(lead?.received_at);
    if (!submittedAt) return false;

    const parsed = new Date(submittedAt);
    if (Number.isNaN(parsed.getTime())) return false;

    const routeStatus = normalizeString(lead?.route_status).toLowerCase();
    const status = normalizeString(lead?.status).toLowerCase();
    if (routeStatus === "done" || status === "completed") return false;

    const ageMs = Date.now() - parsed.getTime();
    return ageMs >= 48 * 60 * 60 * 1000;
  }

  function getPreferredTimeWeight(lead) {
    const preferredTime = normalizeString(lead?.preferred_time).toLowerCase();
    if (preferredTime.includes("morning")) return 20;
    if (preferredTime.includes("afternoon")) return 10;
    if (preferredTime.includes("anytime")) return 5;
    return 0;
  }

  function getCityClusterWeight(lead) {
    const city = normalizeString(lead?.city).toLowerCase();
    if (city.includes("kitchener")) return 15;
    if (city.includes("waterloo")) return 12;
    if (city.includes("cambridge")) return 10;
    return 4;
  }

  function getHybridScore(lead) {
    let score = 0;
    if (isLeadUrgent(lead)) score += 100;
    if (isLeadOverdue(lead)) score += 50;
    score += getPreferredTimeWeight(lead);
    score += getCityClusterWeight(lead);
    return score;
  }

  function getLeadBadgeClass(lead) {
    return isLeadUrgent(lead) ? "urgent" : "";
  }

  function getLeadBadgeText(lead) {
    const priority = normalizeString(lead?.priority);
    const routeStatus = normalizeString(lead?.route_status) || "unrouted";

    if (priority.toLowerCase().includes("urgent")) return "Urgent";
    if (normalizeString(lead?.service_type).toLowerCase().includes("emergency"))
      return "Emergency";

    return routeStatus;
  }

  function filterOutRoutedLeads(leads) {
    return (Array.isArray(leads) ? leads : []).filter((lead) => {
      const routeStatus = normalizeString(lead?.route_status).toLowerCase();
      return !["routed", "arrived", "done"].includes(routeStatus);
    });
  }

  function dedupeByAddress(leads) {
    const seen = new Set();

    return (Array.isArray(leads) ? leads : []).filter((lead) => {
      const normalized = normalizeAddress(getLeadAddress(lead));
      if (!normalized) return true;
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  function groupLeadsForRouting(leads) {
    const groups = new Map();

    (Array.isArray(leads) ? leads : []).forEach((lead) => {
      const key = `${normalizeString(lead?.city).toLowerCase()}::${normalizeAddress(
        getLeadAddress(lead)
      )}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(lead);
    });

    return Array.from(groups.values());
  }

  function orderLeadGroups(leadGroups) {
    return [...leadGroups].sort((groupA, groupB) => {
      const bestA = Math.max(...groupA.map(getHybridScore));
      const bestB = Math.max(...groupB.map(getHybridScore));
      if (bestB !== bestA) return bestB - bestA;

      const cityA = normalizeString(groupA[0]?.city).toLowerCase();
      const cityB = normalizeString(groupB[0]?.city).toLowerCase();
      if (cityA < cityB) return -1;
      if (cityA > cityB) return 1;

      const addressA = normalizeAddress(getLeadAddress(groupA[0]));
      const addressB = normalizeAddress(getLeadAddress(groupB[0]));
      if (addressA < addressB) return -1;
      if (addressA > addressB) return 1;

      return 0;
    });
  }

  function buildSmarterRoute(selectedLeads, emergencyOnly) {
    const sourceLeads = emergencyOnly
      ? selectedLeads.filter(isLeadUrgent)
      : selectedLeads;
    const deduped = dedupeByAddress(sourceLeads);
    const grouped = groupLeadsForRouting(deduped);
    const orderedGroups = orderLeadGroups(grouped);

    return orderedGroups.map((group, index) => {
      const lead = group[0];
      return {
        ...lead,
        route_order: index,
        grouped_lead_ids: group.map(getLeadId).filter(Boolean),
        grouped_count: group.length,
      };
    });
  }

  function toggleLeadSelection(lead) {
    const leadId = getLeadId(lead);
    if (!leadId) return;

    if (state.selectedLeadIds.includes(leadId)) {
      state.selectedLeadIds = state.selectedLeadIds.filter((id) => id !== leadId);
    } else {
      state.selectedLeadIds = [...state.selectedLeadIds, leadId];
    }

    updateSelectionNote();
    renderLeads(state.allLeads);
  }

  function buildDeletePayloadFromLeads(leads) {
    const safeLeads = Array.isArray(leads) ? leads : [];
    const leadIds = uniqueStrings(safeLeads.map(getLeadId));
    const businessIds = uniqueStrings(safeLeads.map(getLeadBusinessId));
    const dbIds = uniqueStrings(safeLeads.map(getLeadDbId));

    return {
      leadIds,
      lead_ids: businessIds,
      ids: dbIds,
    };
  }

  function buildLeadCardHtml(lead) {
    const firstName = formatDisplay(lead?.first_name, "");
    const lastName = formatDisplay(lead?.last_name, "");
    const fullName = `${firstName} ${lastName}`.trim() || "Unnamed Lead";

    const address = getLeadAddress(lead);
    const city = formatDisplay(lead?.city);
    const serviceType = formatDisplay(lead?.service_type);
    const priority = formatDisplay(lead?.priority);
    const preferredTime = formatDisplay(lead?.preferred_time);
    const routeStatus = formatDisplay(lead?.route_status, "unrouted");
    const badgeClass = getLeadBadgeClass(lead);
    const badgeText = getLeadBadgeText(lead);
    const phone = getLeadPhone(lead);
    const selected = isSelectedLead(lead);
    const score = getHybridScore(lead);

    return `
      <div class="lead-card ${selected ? "selected" : ""}" data-lead-id="${escapeHtml(
      getLeadId(lead)
    )}">
        <div class="lead-select-row">
          <div class="lead-select-label">Tap to select</div>
          <input class="lead-checkbox" type="checkbox" ${
            selected ? "checked" : ""
          } tabindex="-1" aria-hidden="true" />
        </div>

        <div class="lead-top">
          <div class="lead-name">${escapeHtml(fullName)}</div>
          <div class="lead-badge ${escapeHtml(badgeClass)}">${escapeHtml(
      badgeText
    )}</div>
        </div>

        <div class="lead-address">${escapeHtml(address || city)}</div>
        <div class="lead-received">Received: ${escapeHtml(
          formatLeadReceivedDate(lead)
        )}</div>

        <div class="lead-meta">
          <div class="meta-box">
            <div class="meta-label">Service</div>
            <div class="meta-value">${escapeHtml(serviceType)}</div>
          </div>

          <div class="meta-box">
            <div class="meta-label">Priority</div>
            <div class="meta-value">${escapeHtml(priority)}</div>
          </div>

          <div class="meta-box">
            <div class="meta-label">Preferred Time</div>
            <div class="meta-value">${escapeHtml(preferredTime)}</div>
          </div>

          <div class="meta-box">
            <div class="meta-label">Route Status</div>
            <div class="meta-value">${escapeHtml(routeStatus)}</div>
          </div>
        </div>

        <div class="lead-score">Route Score: ${escapeHtml(String(score))}</div>

        <div class="lead-actions">
          <button class="action-btn call-btn" type="button" data-phone="${escapeHtml(
            phone
          )}">Call</button>
          <button class="action-btn map-btn" type="button" data-address="${escapeHtml(
            address
          )}">Map</button>
          <button class="action-btn delete-btn" type="button" data-delete="${escapeHtml(
            getLeadId(lead)
          )}">Delete</button>
        </div>
      </div>
    `;
  }

  function renderLeads(leads) {
    if (!els.leadList) return;

    if (!Array.isArray(leads) || leads.length === 0) {
      renderEmptyState("No leads match this filter right now.");
      return;
    }

    const grouped = groupLeadsByReceivedDay(leads);

    els.leadList.innerHTML = grouped
      .map(
        (group) => `
        <section class="day-section">
          <div class="day-section-header">
            <div class="day-title">${escapeHtml(group.dayLabel)}</div>
            <div class="day-count">${escapeHtml(String(group.items.length))} lead${
          group.items.length === 1 ? "" : "s"
        }</div>
          </div>
          <div class="lead-list">
            ${group.items.map(buildLeadCardHtml).join("")}
          </div>
        </section>
      `
      )
      .join("");

    Array.from(els.leadList.querySelectorAll(".lead-card[data-lead-id]")).forEach(
      (card) => {
        card.addEventListener("click", function () {
          const leadId = normalizeString(card.getAttribute("data-lead-id"));
          const lead = state.allLeads.find((item) => getLeadId(item) === leadId);
          if (!lead) return;
          toggleLeadSelection(lead);
        });
      }
    );

    Array.from(els.leadList.querySelectorAll("[data-phone]")).forEach((btn) => {
      btn.addEventListener("click", function (event) {
        event.stopPropagation();
        const phone = normalizeString(btn.getAttribute("data-phone"));
        if (!phone) {
          window.alert("No phone number available for this lead.");
          return;
        }
        window.location.href = `tel:${phone}`;
      });
    });

    Array.from(els.leadList.querySelectorAll("[data-address]")).forEach((btn) => {
      btn.addEventListener("click", function (event) {
        event.stopPropagation();
        const address = normalizeString(btn.getAttribute("data-address"));
        if (!address) {
          window.alert("No address available for this lead.");
          return;
        }
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          address
        )}`;
        window.open(mapsUrl, "_blank", "noopener,noreferrer");
      });
    });

    Array.from(els.leadList.querySelectorAll("[data-delete]")).forEach((btn) => {
      btn.addEventListener("click", async function (event) {
        event.stopPropagation();

        const clickedLeadId = normalizeString(btn.getAttribute("data-delete"));
        if (!clickedLeadId) return;

        const lead = state.allLeads.find((item) => getLeadId(item) === clickedLeadId);
        if (!lead) {
          window.alert("Could not find that lead in the current list.");
          return;
        }

        const confirmed = window.confirm(
          "Delete this lead permanently? This cannot be undone."
        );
        if (!confirmed) return;

        try {
          const basePayload = buildDeletePayloadFromLeads([lead]);
          const result = await postJson("/api/delete-leads", {
            ...basePayload,
            leadId: clickedLeadId,
            lead_id: getLeadBusinessId(lead) || clickedLeadId,
            id: getLeadDbId(lead) || clickedLeadId,
          });

          if (Number(result?.deleted || 0) < 1) {
            throw new Error(
              result?.message || "Delete request finished, but no rows were actually deleted."
            );
          }

          state.selectedLeadIds = state.selectedLeadIds.filter(
            (id) => id !== clickedLeadId
          );

          await handleRefresh();
          setError("");
          setStatus("Lead deleted.");
        } catch (error) {
          console.error("Delete failed:", error);
          setError(error.message || "Could not delete lead.");
          setStatus("Delete failed.");
        }
      });
    });
  }

  function renderRoute(routeLeads) {
    if (!Array.isArray(routeLeads) || routeLeads.length === 0) {
      renderRouteEmptyState("No route built yet. Select leads and tap Optimize Route.");
      return;
    }

    const startAddress = getStartAddress();
    const endMode = getEndMode();
    const plannedDay = getPlannedDay();

    const startLabel =
      getStartMode() === "home"
        ? "Home Address"
        : getStartMode() === "first"
        ? "First Selected Address"
        : "Custom Address";

    const endLabel = endMode === "round_trip" ? "Round Trip" : "Last Location";

    els.routeOutput.innerHTML = `
      <div class="route-step">
        <div class="route-step-top">
          <div class="route-number">Plan</div>
          <div class="lead-badge">${escapeHtml(plannedDay)}</div>
        </div>
        <div class="route-step-address">Planned route day: ${escapeHtml(
          plannedDay
        )}</div>
        <div class="route-step-meta">You can keep up to ${
          DISPATCH_CONFIG.maxSavedRoutes
        } planned routes saved.</div>
      </div>

      <div class="route-step">
        <div class="route-step-top">
          <div class="route-number">Start</div>
          <div class="lead-badge">${escapeHtml(startLabel)}</div>
        </div>
        <div class="route-step-address">${escapeHtml(startAddress)}</div>
        <div class="route-step-meta">Starting point for this route</div>
      </div>

      ${routeLeads
        .map((lead, index) => {
          const address = getLeadAddress(lead);
          const serviceType = formatDisplay(lead?.service_type);
          const priority = formatDisplay(lead?.priority);
          const preferredTime = formatDisplay(lead?.preferred_time);
          const score = getHybridScore(lead);
          const groupedCount = Number(lead?.grouped_count || 1);

          return `
            <div class="route-step">
              <div class="route-step-top">
                <div class="route-number">Stop ${index + 1}</div>
                <div class="lead-badge ${escapeHtml(getLeadBadgeClass(lead))}">
                  ${escapeHtml(getLeadBadgeText(lead))}
                </div>
              </div>

              <div class="route-step-address">${escapeHtml(address)}</div>
              <div class="route-step-meta">
                ${escapeHtml(serviceType)} • ${escapeHtml(priority)} • ${escapeHtml(
            preferredTime
          )} • Score ${escapeHtml(String(score))}${
            groupedCount > 1
              ? ` • ${escapeHtml(String(groupedCount))} jobs at this stop`
              : ""
          }
              </div>
            </div>
          `;
        })
        .join("")}

      <div class="route-step">
        <div class="route-step-top">
          <div class="route-number">End</div>
          <div class="lead-badge">${escapeHtml(endLabel)}</div>
        </div>
        <div class="route-step-address">${
          endMode === "round_trip"
            ? escapeHtml(startAddress)
            : escapeHtml(getLeadAddress(routeLeads[routeLeads.length - 1]) || "Last route stop")
        }</div>
        <div class="route-step-meta">${
          endMode === "round_trip"
            ? "Route returns to the start point."
            : "Route ends at the last stop."
        }</div>
      </div>
    `;
  }

  async function loadCounts() {
    state.isLoadingCounts = true;
    setLoadingButtons();
    setError("");

    try {
      const [urgent, today, overdue, unrouted] = await Promise.all([
        fetchJson("/api/leads-db?urgent=true"),
        fetchJson("/api/leads-db?today=true"),
        fetchJson("/api/leads-db?overdue=true"),
        fetchJson("/api/leads-db?route_status=unrouted"),
      ]);

      const urgentLeads = filterOutRoutedLeads(urgent.leads);
      const todayLeads = filterOutRoutedLeads(today.leads);
      const overdueLeads = filterOutRoutedLeads(overdue.leads);
      const unroutedLeads = filterOutRoutedLeads(unrouted.leads);

      if (els.urgentCount) els.urgentCount.textContent = String(urgentLeads.length);
      if (els.todayCount) els.todayCount.textContent = String(todayLeads.length);
      if (els.overdueCount) els.overdueCount.textContent = String(overdueLeads.length);
      if (els.unroutedCount)
        els.unroutedCount.textContent = String(unroutedLeads.length);
    } catch (error) {
      console.error("Failed to load dashboard counts:", error);
      setError("Could not load dashboard counts. Please refresh.");
    } finally {
      state.isLoadingCounts = false;
      setLoadingButtons();
    }
  }

  async function loadLeadView(filterKey) {
    state.isLoadingLeads = true;
    setLoadingButtons();
    setError("");
    renderLoadingState();
    setActiveFilterUi(filterKey);

    try {
      const query = getFilterQuery(filterKey);
      const path = query ? `/api/leads-db?${query}` : "/api/leads-db";
      const result = await fetchJson(path);

      state.allLeads = sortLeadsByReceivedFirst(
        filterOutRoutedLeads(result.leads)
      );

      state.selectedLeadIds = state.selectedLeadIds.filter((selectedId) =>
        state.allLeads.some((lead) => getLeadId(lead) === selectedId)
      );

      renderLeads(state.allLeads);

      const count = state.allLeads.length;
      setStatus(
        `${getFilterTitle(filterKey)} loaded: ${count} lead${count === 1 ? "" : "s"}.`
      );
    } catch (error) {
      console.error("Failed to load lead view:", error);
      renderEmptyState("Could not load leads.");
      setError("Could not load dispatch leads. Please refresh and try again.");
      setStatus("Load failed.");
    } finally {
      state.isLoadingLeads = false;
      setLoadingButtons();
      updateSelectionNote();
    }
  }

  async function assignRoute(routeLeads, routeId, assignedDay) {
    await postJson("/api/route/assign", {
      lead_ids: routeLeads.map(getLeadId).filter(Boolean),
      route_id: routeId,
      assigned_day: assignedDay,
    });
  }

  function makeRouteLabel(assignedDay, emergencyOnly) {
    const date = new Date(`${assignedDay}T00:00:00`);
    const prettyDay = Number.isNaN(date.getTime())
      ? assignedDay
      : date.toLocaleDateString("en-CA", {
          weekday: "long",
          month: "short",
          day: "numeric",
        });

    return emergencyOnly ? `Emergency Route - ${prettyDay}` : `Route - ${prettyDay}`;
  }

  async function createAndOpenRoute(emergencyOnly) {
    const selectedLeads = state.allLeads.filter((lead) =>
      state.selectedLeadIds.includes(getLeadId(lead))
    );

    if (!selectedLeads.length) {
      state.optimizedRoute = [];
      renderRoute([]);
      setStatus("No jobs selected. Tap leads first, then optimize.");
      return;
    }

    const currentRoutes = getRoutes();
    if (currentRoutes.length >= DISPATCH_CONFIG.maxSavedRoutes) {
      window.alert(
        `You can only keep ${DISPATCH_CONFIG.maxSavedRoutes} planned routes at a time. Delete one first.`
      );
      return;
    }

    const smarterRoute = buildSmarterRoute(selectedLeads, emergencyOnly);

    if (!smarterRoute.length) {
      state.optimizedRoute = [];
      renderRoute([]);
      setStatus(
        emergencyOnly
          ? "No emergency jobs found in your selected leads."
          : "No valid route could be created."
      );
      return;
    }

    const startLocation = await resolveStartLocation();
    const endMode = getEndMode();
    const assignedDay = getPlannedDay();
    const routeId = `route_${Date.now()}`;

    try {
      await assignRoute(smarterRoute, routeId, assignedDay);

      const routeData = {
        id: routeId,
        label: makeRouteLabel(assignedDay, emergencyOnly),
        createdAt: new Date().toISOString(),
        type: emergencyOnly ? "emergency" : "standard",
        assignedDay,
        startAddress: startLocation.address,
        startLat: startLocation.lat,
        startLng: startLocation.lng,
        startSource: startLocation.source,
        endMode,
        wasEdited: false,
        stops: smarterRoute,
      };

      const routes = getRoutes();
      setRoutes([...routes, routeData]);
      setActiveRouteId(routeData.id);

      state.optimizedRoute = smarterRoute;
      renderRoute(smarterRoute);
      state.selectedLeadIds = [];
      updateSelectionNote();
      updateResumeRouteButton();

      await Promise.all([loadCounts(), loadLeadView(state.activeFilter)]);
      window.location.href = "./route.html";
    } catch (error) {
      console.error("Failed to optimize route:", error);
      removeRouteFromStorage(routeId);
      setError("Could not create route. Please try again.");
      setStatus("Route creation failed.");
    }
  }

  async function optimizeRoute() {
    await createAndOpenRoute(false);
  }

  async function emergencyOptimizeRoute() {
    const emergencyLeads = state.allLeads.filter(
      (lead) => state.selectedLeadIds.includes(getLeadId(lead)) && isLeadUrgent(lead)
    );

    if (!emergencyLeads.length) {
      window.alert("No emergency jobs selected.");
      return;
    }

    state.selectedLeadIds = emergencyLeads.map(getLeadId).filter(Boolean);
    await createAndOpenRoute(true);
  }

  async function batchDeleteSelected() {
    const ids = [...state.selectedLeadIds];
    if (!ids.length) {
      window.alert("Select leads first.");
      return;
    }

    const leadsToDelete = state.allLeads.filter((lead) => ids.includes(getLeadId(lead)));

    if (!leadsToDelete.length) {
      window.alert("Could not find the selected leads in the current list.");
      return;
    }

    const confirmed = window.confirm(
      `Delete ${ids.length} selected lead${ids.length === 1 ? "" : "s"} permanently?`
    );
    if (!confirmed) return;

    try {
      const result = await postJson(
        "/api/delete-leads",
        buildDeletePayloadFromLeads(leadsToDelete)
      );

      if (Number(result?.deleted || 0) < 1) {
        throw new Error(
          result?.message || "Delete request finished, but no rows were actually deleted."
        );
      }

      state.selectedLeadIds = [];
      await handleRefresh();
      setError("");
      setStatus("Selected leads deleted.");
    } catch (error) {
      console.error("Batch delete failed:", error);
      setError(error.message || "Could not delete selected leads.");
      setStatus("Batch delete failed.");
    }
  }

  async function handleRefresh() {
    await Promise.all([loadCounts(), loadLeadView(state.activeFilter)]);
  }

  function bindEvents() {
    if (els.refreshBtn) els.refreshBtn.addEventListener("click", handleRefresh);
    if (els.showAllBtn)
      els.showAllBtn.addEventListener("click", () => loadLeadView(null));
    if (els.clearFilterBtn)
      els.clearFilterBtn.addEventListener("click", () => loadLeadView(null));
    if (els.optimizeBtn) els.optimizeBtn.addEventListener("click", optimizeRoute);
    if (els.emergencyOptimizeBtn)
      els.emergencyOptimizeBtn.addEventListener("click", emergencyOptimizeRoute);
    if (els.batchDeleteBtn)
      els.batchDeleteBtn.addEventListener("click", batchDeleteSelected);
    if (els.resumeRouteBtn)
      els.resumeRouteBtn.addEventListener("click", () => {
        window.location.href = "./route.html";
      });
    if (els.startModeSelect)
      els.startModeSelect.addEventListener("change", updateStartInputUi);

    els.filterCards.forEach((card) => {
      card.addEventListener("click", () => {
        const filterKey = normalizeString(card.dataset.filter);
        loadLeadView(filterKey);
      });
    });
  }

  async function init() {
    bindEvents();
    buildRouteDayOptions();
    setActiveFilterUi(null);
    updateSelectionNote();
    updateStartInputUi();
    updateResumeRouteButton();
    initCustomStartAutocomplete();
    renderRoute([]);

    await Promise.all([loadCounts(), loadLeadView(null)]);
  }

  init();
})();
