const DISPATCH_CONFIG = {
  apiBaseUrl:
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
      ? "http://localhost:4000"
      : "https://yrs-lead-api.onrender.com",
};

(function () {
  const els = {
    refreshBtn: document.getElementById("refreshBtn"),
    showAllBtn: document.getElementById("showAllBtn"),
    clearFilterBtn: document.getElementById("clearFilterBtn"),
    statusBar: document.getElementById("statusBar"),
    panelTitle: document.getElementById("panelTitle"),
    panelSubtitle: document.getElementById("panelSubtitle"),
    leadList: document.getElementById("leadList"),
    errorBox: document.getElementById("errorBox"),

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

  function parseBoolean(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
    return null;
  }

  function getApiUrl(path) {
    return `${DISPATCH_CONFIG.apiBaseUrl}${path}`;
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
        return "Showing all dispatch-ready leads";
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

    return `
      <div class="lead-card">
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

    Array.from(els.leadList.querySelectorAll("[data-phone]")).forEach((btn) => {
      btn.addEventListener("click", function () {
        const phone = normalizeString(btn.getAttribute("data-phone"));
        if (!phone) {
          alert("No phone number available for this lead.");
          return;
        }

        window.location.href = `tel:${phone}`;
      });
    });

    Array.from(els.leadList.querySelectorAll("[data-address]")).forEach((btn) => {
      btn.addEventListener("click", function () {
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

      if (els.urgentCount) els.urgentCount.textContent = String(urgent.count || 0);
      if (els.todayCount) els.todayCount.textContent = String(today.count || 0);
      if (els.overdueCount) els.overdueCount.textContent = String(overdue.count || 0);
      if (els.unroutedCount) els.unroutedCount.textContent = String(unrouted.count || 0);
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

      state.allLeads = Array.isArray(result.leads) ? result.leads : [];
      renderLeads(state.allLeads);

      const count = result.count || 0;
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
    renderLoadingState();

    await Promise.all([
      loadCounts(),
      loadLeadView(null),
    ]);
  }

  init();
})();