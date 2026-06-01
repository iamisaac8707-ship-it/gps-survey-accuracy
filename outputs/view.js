(function () {
  "use strict";

  const DEFAULT_LOCATION = { lat: 37.5665, lng: 126.978 };
  const FALLBACK_MAP_SPAN = 0.01;

  function formatMeters(value) {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)} m` : "-";
  }

  function formatPercent(value) {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}%` : "-";
  }

  function formatCoordinate(location) {
    if (!location) return "-";
    return `${Number(location.lat).toFixed(6)}, ${Number(location.lng).toFixed(6)}`;
  }

  function formatDateTime(isoString) {
    if (!isoString) return "-";
    return new Intl.DateTimeFormat("ko-KR", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(isoString));
  }

  function createDatasetColor(variableName, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim() || fallback;
  }

  class AppView {
    constructor() {
      this.mapElement = document.getElementById("map");
      this.mapStatus = document.getElementById("mapStatus");
      this.locationStatus = document.getElementById("locationStatus");
      this.syncStatus = document.getElementById("syncStatus");
      this.gpsAccuracy = document.getElementById("gpsAccuracy");
      this.currentLocationText = document.getElementById("currentLocationText");
      this.endLocationText = document.getElementById("endLocationText");
      this.gpsDistanceText = document.getElementById("gpsDistanceText");
      this.distanceMetric = document.getElementById("distanceMetric");
      this.countMetric = document.getElementById("countMetric");
      this.avgRelativeMetric = document.getElementById("avgRelativeMetric");
      this.maxAbsoluteMetric = document.getElementById("maxAbsoluteMetric");
      this.environmentSelect = document.getElementById("environmentSelect");
      this.actualDistanceInput = document.getElementById("actualDistanceInput");
      this.measurementForm = document.getElementById("measurementForm");
      this.refreshLocationBtn = document.getElementById("refreshLocationBtn");
      this.downloadCsvBtn = document.getElementById("downloadCsvBtn");
      this.tableBody = document.getElementById("measurementTableBody");
      this.sortStatus = document.getElementById("sortStatus");
      this.relativeErrorCanvas = document.getElementById("relativeErrorChart");
      this.environmentErrorCanvas = document.getElementById("environmentErrorChart");

      this.kakaoMap = null;
      this.kakaoCurrentMarker = null;
      this.kakaoEndMarker = null;
      this.kakaoPolyline = null;
      this.mapMode = "pending";
      this.destinationHandler = null;
      this.relativeErrorChart = null;
      this.environmentErrorChart = null;
    }

    bindRefreshLocation(handler) {
      this.refreshLocationBtn.addEventListener("click", handler);
    }

    bindSaveMeasurement(handler) {
      this.measurementForm.addEventListener("submit", (event) => {
        event.preventDefault();
        handler();
      });
    }

    bindDownloadCsv(handler) {
      this.downloadCsvBtn.addEventListener("click", handler);
    }

    bindTableActions({ onDelete, onSort }) {
      document.querySelector(".table-panel").addEventListener("click", (event) => {
        const deleteButton = event.target.closest("[data-action='delete']");
        if (deleteButton) {
          onDelete(deleteButton.dataset.id);
          return;
        }

        const sortButton = event.target.closest("[data-sort]");
        if (sortButton) {
          onSort(sortButton.dataset.sort);
        }
      });
    }

    renderEnvironmentOptions(environments) {
      this.environmentSelect.innerHTML = environments
        .map((environment) => `<option value="${environment.value}">${environment.label}</option>`)
        .join("");
    }

    getFormData() {
      return {
        actualDistance: this.actualDistanceInput.value,
        environment: this.environmentSelect.value,
      };
    }

    resetFormAfterSave() {
      this.actualDistanceInput.value = "";
      this.actualDistanceInput.focus();
    }

    async initMap(onDestinationSelect) {
      this.destinationHandler = onDestinationSelect;

      if (!window.kakao?.maps?.load) {
        await this.loadKakaoSdk();
      }

      if (window.kakao?.maps?.load) {
        try {
          await new Promise((resolve) => window.kakao.maps.load(resolve));
          this.setupKakaoMap();
          return "kakao";
        } catch (error) {
          console.warn("카카오맵 초기화 실패:", error);
        }
      }

      this.setupFallbackMap();
      return "fallback";
    }

    loadKakaoSdk() {
      const apiKey = window.KAKAO_MAP_API_KEY;
      if (!apiKey || apiKey === "YOUR_KAKAO_MAP_API_KEY") {
        return Promise.resolve(false);
      }

      return new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(apiKey)}&autoload=false`;
        script.async = true;
        script.onload = () => resolve(true);
        script.onerror = () => {
          console.warn("카카오맵 SDK를 불러오지 못했습니다. 데모 지도로 전환합니다.");
          resolve(false);
        };
        document.head.appendChild(script);
      });
    }

    setupKakaoMap() {
      const center = new window.kakao.maps.LatLng(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lng);
      this.kakaoMap = new window.kakao.maps.Map(this.mapElement, {
        center,
        level: 3,
      });

      window.kakao.maps.event.addListener(this.kakaoMap, "click", (mouseEvent) => {
        const latLng = mouseEvent.latLng;
        this.destinationHandler({
          lat: latLng.getLat(),
          lng: latLng.getLng(),
        });
      });

      this.mapMode = "kakao";
      this.mapStatus.textContent = "카카오맵 연결됨";
    }

    setupFallbackMap() {
      this.mapMode = "fallback";
      this.mapStatus.textContent = "API 키 입력 전 데모 지도";
      this.mapElement.innerHTML = `
        <svg class="fallback-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line id="fallbackLine" x1="50" y1="50" x2="50" y2="50"></line>
        </svg>
        <div id="fallbackCurrentMarker" class="fallback-marker current is-hidden" aria-hidden="true"></div>
        <div id="fallbackEndMarker" class="fallback-marker destination is-hidden" aria-hidden="true"></div>
        <div class="fallback-grid-label">카카오맵 API 키를 넣으면 실제 지도가 표시됩니다. 현재는 클릭 가능한 데모 격자로 목적지를 선택합니다.</div>
      `;
      this.fallbackLine = document.getElementById("fallbackLine");
      this.fallbackCurrentMarker = document.getElementById("fallbackCurrentMarker");
      this.fallbackEndMarker = document.getElementById("fallbackEndMarker");

      this.mapElement.addEventListener("click", (event) => {
        const rect = this.mapElement.getBoundingClientRect();
        const xRatio = (event.clientX - rect.left) / rect.width;
        const yRatio = (event.clientY - rect.top) / rect.height;
        const currentLocation = this.lastCurrentLocation || DEFAULT_LOCATION;
        this.destinationHandler({
          lat: currentLocation.lat + (0.5 - yRatio) * FALLBACK_MAP_SPAN,
          lng: currentLocation.lng + (xRatio - 0.5) * FALLBACK_MAP_SPAN,
        });
      });
    }

    updateMap({ currentLocation, endLocation }) {
      this.lastCurrentLocation = currentLocation;

      if (this.mapMode === "kakao" && this.kakaoMap && currentLocation) {
        this.updateKakaoMap(currentLocation, endLocation);
        return;
      }

      if (this.mapMode === "fallback") {
        this.updateFallbackMap(currentLocation, endLocation);
      }
    }

    updateKakaoMap(currentLocation, endLocation) {
      const currentLatLng = new window.kakao.maps.LatLng(currentLocation.lat, currentLocation.lng);
      if (!this.kakaoCurrentMarker) {
        this.kakaoCurrentMarker = new window.kakao.maps.Marker({ map: this.kakaoMap });
      }
      this.kakaoCurrentMarker.setPosition(currentLatLng);
      this.kakaoMap.setCenter(currentLatLng);

      if (endLocation) {
        const endLatLng = new window.kakao.maps.LatLng(endLocation.lat, endLocation.lng);
        if (!this.kakaoEndMarker) {
          this.kakaoEndMarker = new window.kakao.maps.Marker({ map: this.kakaoMap });
        }
        this.kakaoEndMarker.setPosition(endLatLng);

        if (!this.kakaoPolyline) {
          this.kakaoPolyline = new window.kakao.maps.Polyline({
            map: this.kakaoMap,
            strokeWeight: 4,
            strokeColor: "#0f9f8f",
            strokeOpacity: 0.9,
            strokeStyle: "shortdash",
          });
        }
        this.kakaoPolyline.setPath([currentLatLng, endLatLng]);

        const bounds = new window.kakao.maps.LatLngBounds();
        bounds.extend(currentLatLng);
        bounds.extend(endLatLng);
        this.kakaoMap.setBounds(bounds, 42, 42, 42, 42);
      }
    }

    updateFallbackMap(currentLocation, endLocation) {
      if (!this.fallbackCurrentMarker || !this.fallbackEndMarker || !this.fallbackLine) return;

      if (currentLocation) {
        this.fallbackCurrentMarker.classList.remove("is-hidden");
        this.fallbackCurrentMarker.style.left = "50%";
        this.fallbackCurrentMarker.style.top = "50%";
      }

      if (!currentLocation || !endLocation) {
        this.fallbackEndMarker.classList.add("is-hidden");
        this.fallbackLine.setAttribute("x2", "50");
        this.fallbackLine.setAttribute("y2", "50");
        return;
      }

      const x = Math.max(5, Math.min(95, 50 + ((endLocation.lng - currentLocation.lng) / FALLBACK_MAP_SPAN) * 100));
      const y = Math.max(5, Math.min(95, 50 - ((endLocation.lat - currentLocation.lat) / FALLBACK_MAP_SPAN) * 100));
      this.fallbackEndMarker.classList.remove("is-hidden");
      this.fallbackEndMarker.style.left = `${x}%`;
      this.fallbackEndMarker.style.top = `${y}%`;
      this.fallbackLine.setAttribute("x1", "50");
      this.fallbackLine.setAttribute("y1", "50");
      this.fallbackLine.setAttribute("x2", String(x));
      this.fallbackLine.setAttribute("y2", String(y));
    }

    renderLocation({ currentLocation, endLocation, gpsDistance }) {
      this.currentLocationText.textContent = formatCoordinate(currentLocation);
      this.endLocationText.textContent = formatCoordinate(endLocation);
      this.gpsDistanceText.textContent = formatMeters(gpsDistance);
      this.distanceMetric.textContent = formatMeters(gpsDistance);
    }

    renderGpsAccuracy(accuracy) {
      this.gpsAccuracy.textContent = Number.isFinite(Number(accuracy))
        ? `현재 GPS 정확도: ±${Number(accuracy).toFixed(2)}미터`
        : "현재 GPS 정확도: 미제공";
    }

    renderLocationStatus(message) {
      this.locationStatus.textContent = message;
    }

    setLocationLoading(isLoading) {
      this.refreshLocationBtn.disabled = isLoading;
      this.refreshLocationBtn.classList.toggle("is-loading", isLoading);
    }

    renderSummary(summary) {
      this.countMetric.textContent = `${summary.count}건`;
      this.avgRelativeMetric.textContent = formatPercent(summary.averageRelativeError);
      this.maxAbsoluteMetric.textContent = formatMeters(summary.maxAbsoluteError);
    }

    renderSyncStatus(status) {
      this.syncStatus.classList.toggle("is-online", status.mode === "supabase");
      this.syncStatus.classList.toggle("is-error", status.mode === "error");
      this.syncStatus.querySelector("span:last-child").textContent = status.label;
      this.syncStatus.title = status.detail || "";
    }

    renderMeasurements(measurements, sortState, options = {}) {
      const canDelete = options.canDelete !== false;
      this.sortStatus.textContent = this.getSortStatus(sortState);

      document.querySelectorAll(".sort-button").forEach((button) => {
        const isActive = button.dataset.sort === sortState.key;
        button.classList.toggle("is-active", isActive);
        button.classList.toggle("asc", isActive && sortState.direction === "asc");
        button.classList.toggle("desc", isActive && sortState.direction === "desc");
      });

      if (!measurements.length) {
        this.tableBody.innerHTML =
          '<tr><td colspan="7" class="empty-cell">저장된 측정 데이터가 없습니다.</td></tr>';
        return;
      }

      this.tableBody.innerHTML = measurements
        .map(
          (item) => `
            <tr>
              <td>${formatDateTime(item.timestamp)}</td>
              <td>${item.environment}</td>
              <td>${Number(item.gpsDistance).toFixed(2)}</td>
              <td>${Number(item.actualDistance).toFixed(2)}</td>
              <td>${Number(item.absoluteError).toFixed(2)}</td>
              <td class="${Number(item.relativeError) >= 10 ? "error-text" : ""}">${Number(item.relativeError).toFixed(2)}</td>
              <td>
                ${
                  canDelete
                    ? `<button class="icon-button" type="button" data-action="delete" data-id="${item.id}" aria-label="측정 데이터 삭제">
                        <i data-lucide="trash-2" aria-hidden="true"></i>
                      </button>`
                    : '<span class="read-only-chip">DB 보관</span>'
                }
              </td>
            </tr>
          `
        )
        .join("");

      this.refreshIcons();
    }

    getSortStatus(sortState) {
      const labels = {
        timestamp: "일시",
        environment: "환경",
        gpsDistance: "GPS 거리",
        actualDistance: "실측값",
        absoluteError: "절대 오차",
        relativeError: "상대 오차",
      };
      return `${labels[sortState.key] || "일시"} ${sortState.direction === "asc" ? "오름차순" : "내림차순"}`;
    }

    renderCharts(measurements, environmentAverages) {
      if (!window.Chart) return;

      const accent = createDatasetColor("--accent", "#0f9f8f");
      const amber = createDatasetColor("--amber", "#c87812");
      const border = createDatasetColor("--border", "#dbe5e8");
      const muted = createDatasetColor("--muted", "#647581");

      const lineLabels = measurements.map((_, index) => `${index + 1}회`);
      const lineData = measurements.map((item) => item.relativeError);

      if (!this.relativeErrorChart) {
        this.relativeErrorChart = new window.Chart(this.relativeErrorCanvas, {
          type: "line",
          data: {
            labels: lineLabels,
            datasets: [
              {
                label: "상대 오차율(%)",
                data: lineData,
                borderColor: accent,
                backgroundColor: "rgba(15, 159, 143, 0.12)",
                tension: 0.35,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6,
              },
            ],
          },
          options: this.getChartOptions("상대 오차율(%)", border, muted),
        });
      } else {
        this.relativeErrorChart.data.labels = lineLabels;
        this.relativeErrorChart.data.datasets[0].data = lineData;
        this.relativeErrorChart.update();
      }

      if (!this.environmentErrorChart) {
        this.environmentErrorChart = new window.Chart(this.environmentErrorCanvas, {
          type: "bar",
          data: {
            labels: environmentAverages.labels,
            datasets: [
              {
                label: "평균 절대 오차(m)",
                data: environmentAverages.data,
                borderRadius: 6,
                backgroundColor: [accent, amber, "#2868c8", "#d84b4b"],
              },
            ],
          },
          options: this.getChartOptions("평균 절대 오차(m)", border, muted),
        });
      } else {
        this.environmentErrorChart.data.labels = environmentAverages.labels;
        this.environmentErrorChart.data.datasets[0].data = environmentAverages.data;
        this.environmentErrorChart.update();
      }
    }

    getChartOptions(yTitle, gridColor, labelColor) {
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: labelColor,
              font: { weight: 700 },
            },
          },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${Number(context.raw).toFixed(2)}`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: labelColor, font: { weight: 700 } },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: yTitle, color: labelColor, font: { weight: 800 } },
            ticks: { color: labelColor, font: { weight: 700 } },
            grid: { color: gridColor },
          },
        },
      };
    }

    downloadFile(filename, content) {
      const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    showAlert(message) {
      window.alert(message);
    }

    refreshIcons() {
      if (window.lucide?.createIcons) {
        window.lucide.createIcons();
      }
    }
  }

  window.AppView = AppView;
})();
