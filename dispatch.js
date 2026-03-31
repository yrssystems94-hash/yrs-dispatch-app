const DISPATCH_CONFIG = {
  apiBaseUrl:
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
      ? "http://localhost:4000"
      : "https://yrs-lead-api.onrender.com",
  defaultStartAddress: "10 Carlyle Pl, Kitchener, ON N2P 1R6",
  activeRouteStorageKey: "yrs_active_route",
};

(function () {
  const els = {
    refreshBtn: document.getElementById("refreshBtn"),
    showAllBtn: document.getElementById("showAllBtn"),
    clearFilterBtn: document.getElementById("clearFilterBtn"),
    optimizeBtn: document.getElementById("optimizeBtn"),
    resumeRouteBtn: document.getElementById("resumeRouteBtn"),
    startModeSelect: document.getElementById("startModeSelect"),
    customStartInput: document.getElementById("customStartInput"),
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

  function getApiUrl(path) {
    return `${DISPATCH_CONFIG.apiBaseUrl}${path}`;
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

  function getLeadPhone(lead) {
    return normalizeString(lead.phone);
  }

  function getActiveRoute() {
    try {
      const raw = window.localStorage.getItem(DISPATCH_CONFIG.activeRouteStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function setActiveRoute(routeData) {
    window.localStorage.setItem(
      DISPATCH_CONFIG.activeRouteStorageKey,
      JSON.stringify(routeData)
    );
  }

  function clearActiveRoute() {
    window.localStorage.removeItem(DISPATCH_CONFIG.activeRouteStorageKey);
  }

  function updateResumeRouteButton() {
    if (!els.resumeRouteBtn) return;
    const activeRoute = getActiveRoute();
    els.resumeRouteBtn.hidden = !activeRoute;
  }

  function getStartAddress() {
    const mode = normalizeString(els.startModeSelect?.value) || "home";

    if (mode === "custom") {
      const custom = normalizeString(els.customStartInput?.value);
      return custom || DISPATCH_CONFIG.defaultStartAddress;
    }

    return DISPATCH_CONFIG.defaultStartAddress;
  }

  function updateStartInputUi() {
    if (!els.startModeSelect || !els.customStartInput) return;

    const isCustom = normalizeString(els.startModeSelect.value) === "custom";
    els.customStartInput.hidden = !isCustom;
  }

  function getLeadBadgeClass(lead) {
    const priority = normalizeString(lead.priority).toLowerCase();
    const serviceType = normalizeString(lead.service_type).toLowerCase();
    const details = normalizeString(lead.details).toLowerCase();

    if (
      priority.includes("urgent") ||
      priority.includes("emergency") ||
      serviceType.includes("emergency") ||
      serviceType.includes("leak") ||
      details.includes("leak") ||
      details.includes("urgent")
    ) {
      return "urgent";
    }

    return "";
  }

  function getLeadBadgeText(lead) {
    const priority = normalizeString(lead.priority);
    const routeStatus = normalizeString(lead.route_status) || "unrouted";

    if (priority.toLowerCase().includes("urgent")) return "Urgent";
    if (normalizeString(lead.service_type).toLowerCase().includes("emergency")) return "Emergency";

    return routeStatus;
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
    if (els.refreshBtn) {
      els.refreshBtn.disabled = state.isLoadingCounts || state.isLoadingLeads;
      els.refreshBtn.textContent =
        state.isLoadingCounts || state.isLoadingLeads ? "Loading..." : "Refresh";
    }

    if (els.optimizeBtn) {
      els.optimizeBtn.disabled = state.isLoadingLeads;
      els.optimizeBtn.textContent = state.isLoadingLeads ? "Loading..." : "Optimize Today";
    }
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
        return "All Leads";
    }
  }

  function getFilterSubtitle(filterKey) {
    switch (filterKey) {
      case "urgent":
        return "Leaks, emergencies, and priority jobs first";
      case "today":
        return "Jobs assigned or due today";
      case "overdue":
        return "Leads older than 48 hours and not completed";
      case "unrouted":
        return "Dispatch-ready leads not yet routed";
      default:
        return "Showing dispatch-ready leads only";
    }
  }

  function setActiveFilterUi(filterKey) {
    state.activeFilter = filterKey || null;

    els.filterCards.forEach((card) => {
      const isActive = card.dataset.filter === state.activeFilter;
      card.style.outline = isActive ? "3px solid #14212f" : "none";
      card.style.outlineOffset = isActive ? "2px" : "0";
    });

    if (els.showAllBtn) {
      els.showAllBtn.classList.toggle("active", !state.activeFilter);
    }

    if (els.clearFilterBtn) {
      els.clearFilterBtn.classList.toggle("active", Boolean(state.activeFilter));
    }

    if (els.panelTitle) {
      els.panelTitle.textContent = getFilterTitle(state.activeFilter);
    }

    if (els.panelSubtitle) {
      els.panelSubtitle.textContent = getFilterSubtitle(state.activeFilter);
    }
  }

  async function fetchJson(path) {
    const response = await fetch(getApiUrl(path), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
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

    if (count === 0) {
      els.selectionNote.textContent = "Select jobs first, then optimize your day.";
      return;
    }

    els.selectionNote.textContent = `${count} job${count === 1 ? "" : "s"} selected for routing.`;
  }

  function isSelectedLead(lead) {
    return state.selectedLeadIds.includes(getLeadId(lead));
  }

  function isLeadUrgent(lead) {
    const priority = normalizeString(lead.priority).toLowerCase();
    const serviceType = normalizeString(lead.service_type).toLowerCase();
    const details = normalizeString(lead.details).toLowerCase();

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
    const submittedAt = normalizeString(lead.submitted_at) || normalizeString(lead.received_at);
    if (!submittedAt) return false;

    const parsed = new Date(submittedAt);
    if (Number.isNaN(parsed.getTime())) return false;

    const routeStatus = normalizeString(lead.route_status).toLowerCase();
    const status = normalizeString(lead.status).toLowerCase();

    if (routeStatus === "done" || status === "completed") {
      return false;
    }

    const ageMs = Date.now() - parsed.getTime();
    return ageMs >= 48 * 60 * 60 * 1000;
  }

  function getPreferredTimeWeight(lead) {
    const preferredTime = normalizeString(lead.preferred_time).toLowerCase();

    if (preferredTime.includes("morning")) return 20;
    if (preferredTime.includes("afternoon")) return 10;
    if (preferredTime.includes("anytime")) return 5;

    return 0;
  }

  function getHybridScore(lead) {
    let score = 0;

    if (isLeadUrgent(lead)) score += 100;
    if (isLeadOverdue(lead)) score += 50;

    score += getPreferredTimeWeight(lead);

    return score;
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

  function buildLeadCardHtml(lead) {
    const firstName = formatDisplay(lead.first_name, "");
    const lastName = formatDisplay(lead.last_name, "");
    const fullName = `${firstName} ${lastName}`.trim() || "Unnamed Lead";

    const address = getLeadAddress(lead);
    const city = formatDisplay(lead.city);
    const serviceType = formatDisplay(lead.service_type);
    const priority = formatDisplay(lead.priority);
    const preferredTime = formatDisplay(lead.preferred_time);
    const routeStatus = formatDisplay(lead.route_status, "unrouted");
    const badgeClass = getLeadBadgeClass(lead);
    const badgeText = getLeadBadgeText(lead);
    const phone = getLeadPhone(lead);
    const selected = isSelectedLead(lead);

    return `
      <div class="lead-card ${selected ? "selected" : ""}" data-lead-id="${escapeHtml(getLeadId(lead))}">
        <div class="lead-select-row">
          <div class="lead-select-label">Tap to select</div>
          <input class="lead-checkbox" type="checkbox" ${selected ? "checked" : ""} tabindex="-1" aria-hidden="true" />
        </div>

        <div class="lead-top">
          <div class="lead-name">${escapeHtml(fullName)}</div>
          <div class="lead-badge ${escapeHtml(badgeClass)}">${escapeHtml(badgeText)}</div>
        </div>

        <div class="lead-address">${escapeHtml(address || `${city}`)}</div>

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

        <div class="lead-actions">
          <button class="action-btn call-btn" type="button" data-phone="${escapeHtml(phone)}">
            Call
          </button>
          <button class="action-btn map-btn" type="button" data-address="${escapeHtml(address)}">
            Map
          </button>
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

    els.leadList.innerHTML = leads.map(buildLeadCardHtml).join("");

    Array.from(els.leadList.querySelectorAll(".lead-card[data-lead-id]")).forEach((card) => {
      card.addEventListener("click", function () {
        const leadId = normalizeString(card.getAttribute("data-lead-id"));
        const lead = state.allLeads.find((item) => getLeadId(item) === leadId);
        if (!lead) return;
        toggleLeadSelection(lead);
      });
    });

    Array.from(els.leadList.querySelectorAll("[data-phone]")).forEach((btn) => {
      btn.addEventListener("click", function (event) {
        event.stopPropagation();

        const phone = normalizeString(btn.getAttribute("data-phone"));
        if (!phone) {
          alert("No phone number available for this lead.");
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
          alert("No address available for this lead.");
          return;
        }

        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
        window.open(mapsUrl, "_blank", "noopener,noreferrer");
      });
    });
  }

  function renderRoute(routeLeads) {
    if (!Array.isArray(routeLeads) || routeLeads.length === 0) {
      renderRouteEmptyState("No route built yet. Select leads and tap Optimize Today.");
      return;
    }

    const startAddress = getStartAddress();

    els.routeOutput.innerHTML = `
      <div class="route-step">
        <div class="route-step-top">
          <div class="route-number">Start</div>
          <div class="lead-badge">Home Base</div>
        </div>
        <div class="route-step-address">${escapeHtml(startAddress)}</div>
        <div class="route-step-meta">Starting point for this route</div>
      </div>
      ${routeLeads
        .map((lead, index) => {
          const address = getLeadAddress(lead);
          const serviceType = formatDisplay(lead.service_type);
          const priority = formatDisplay(lead.priority);
          const preferredTime = formatDisplay(lead.preferred_time);
          const score = getHybridScore(lead);

          return `
            <div class="route-step">
              <div class="route-step-top">
                <div class="route-number">Stop ${index + 1}</div>
                <div class="lead-badge ${escapeHtml(getLeadBadgeClass(lead))}">${escapeHtml(getLeadBadgeText(lead))}</div>
              </div>

              <div class="route-step-address">${escapeHtml(address)}</div>
              <div class="route-step-meta">
                ${escapeHtml(serviceType)} • ${escapeHtml(priority)} • ${escapeHtml(preferredTime)} • Score ${score}
              </div>
            </div>
          `;
        })
        .join("")}
    `;
  }

  function filterOutRoutedLeads(leads) {
    return (Array.isArray(leads) ? leads : []).filter((lead) => {
      const routeStatus = normalizeString(lead.route_status).toLowerCase();
      return routeStatus !== "routed";
    });
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
      if (els.unroutedCount) els.unroutedCount.textContent = String(unroutedLeads.length);
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

      state.allLeads = filterOutRoutedLeads(result.leads);
      renderLeads(state.allLeads);

      const count = state.allLeads.length;
      setStatus(`${getFilterTitle(filterKey)} loaded: ${count} lead${count === 1 ? "" : "s"}.`);
    } catch (error) {
      console.error("Failed to load lead view:", error);
      renderEmptyState("Could not load leads.");
      setError("Could not load dispatch leads. Please refresh and try again.");
      setStatus("Load failed.");
    } finally {
      state.isLoadingLeads = false;
      setLoadingButtons();
    }
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

  async function optimizeRoute() {
    const selectedLeads = state.allLeads.filter((lead) =>
      state.selectedLeadIds.includes(getLeadId(lead))
    );

    if (!selectedLeads.length) {
      state.optimizedRoute = [];
      renderRoute([]);
      setStatus("No jobs selected. Tap leads first, then optimize.");
      return;
    }

    const sorted = [...selectedLeads].sort((a, b) => {
      const scoreDifference = getHybridScore(b) - getHybridScore(a);
      if (scoreDifference !== 0) return scoreDifference;

      const cityA = normalizeString(a.city).toLowerCase();
      const cityB = normalizeString(b.city).toLowerCase();
      if (cityA < cityB) return -1;
      if (cityA > cityB) return 1;

      const addressA = getLeadAddress(a).toLowerCase();
      const addressB = getLeadAddress(b).toLowerCase();
      if (addressA < addressB) return -1;
      if (addressA > addressB) return 1;

      return 0;
    });

    try {
      const routeLeadIds = sorted.map(getLeadId);
      await updateRouteStatus(routeLeadIds, "routed");

      const routeData = {
        id: `route_${Date.now()}`,
        createdAt: new Date().toISOString(),
        startAddress: getStartAddress(),
        stops: sorted,
      };

      setActiveRoute(routeData);

      state.optimizedRoute = sorted;
      renderRoute(sorted);
      state.selectedLeadIds = [];
      updateSelectionNote();
      updateResumeRouteButton();

      window.location.href = "./route.html";
    } catch (error) {
      console.error("Failed to optimize route:", error);
      setError("Could not create route. Please try again.");
      setStatus("Route creation failed.");
    }
  }

  async function handleRefresh() {
    await Promise.all([
      loadCounts(),
      loadLeadView(state.activeFilter),
    ]);
  }

  function bindEvents() {
    if (els.refreshBtn) {
      els.refreshBtn.addEventListener("click", handleRefresh);
    }

    if (els.showAllBtn) {
      els.showAllBtn.addEventListener("click", function () {
        loadLeadView(null);
      });
    }

    if (els.clearFilterBtn) {
      els.clearFilterBtn.addEventListener("click", function () {
        loadLeadView(null);
      });
    }

    if (els.optimizeBtn) {
      els.optimizeBtn.addEventListener("click", optimizeRoute);
    }

    if (els.resumeRouteBtn) {
      els.resumeRouteBtn.addEventListener("click", function () {
        window.location.href = "./route.html";
      });
    }

    if (els.startModeSelect) {
      els.startModeSelect.addEventListener("change", updateStartInputUi);
    }

    els.filterCards.forEach((card) => {
      card.addEventListener("click", function () {
        const filterKey = normalizeString(card.dataset.filter);
        loadLeadView(filterKey);
      });
    });
  }

  async function init() {
    bindEvents();
    setActiveFilterUi(null);
    updateSelectionNote();
    updateStartInputUi();
    updateResumeRouteButton();
    renderRoute([]);

    await Promise.all([
      loadCounts(),
      loadLeadView(null),
    ]);
  }

  init();
})();
