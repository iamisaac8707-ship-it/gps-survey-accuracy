(function () {
  "use strict";

  const GEOLOCATION_OPTIONS = {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 5000,
  };

  const FALLBACK_LOCATION = {
    lat: 37.5665,
    lng: 126.978,
    accuracy: null,
  };

  class AppController {
    constructor(model, view) {
      this.model = model;
      this.view = view;
      this.sortState = {
        key: "timestamp",
        direction: "desc",
      };
      this.activePoint = "end";
      this.watchId = null;
    }

    async init() {
      this.view.renderEnvironmentOptions(window.MeasurementConstants.ENVIRONMENTS);
      this.bindEvents();
      await this.view.initMap((location) => this.handleDestinationSelect(location));
      this.view.renderMeasurementMode({
        mode: this.model.measurementMode,
        activePoint: this.activePoint,
      });
      const persistenceStatus = await this.model.initializePersistence();
      this.view.renderSyncStatus(persistenceStatus);
      this.renderAll();
      this.requestCurrentLocation();
      this.startLocationWatch();
      this.view.refreshIcons();
    }

    bindEvents() {
      this.view.bindRefreshLocation(() => this.requestCurrentLocation());
      this.view.bindSaveMeasurement(() => this.handleSaveMeasurement());
      this.view.bindDownloadCsv(() => this.handleCsvDownload());
      this.view.bindMeasurementModeChange((mode) => this.handleMeasurementModeChange(mode));
      this.view.bindPointTargetChange((point) => this.handlePointTargetChange(point));
      this.view.bindTableActions({
        onDelete: (id) => this.handleDeleteMeasurement(id),
        onSort: (key) => this.handleSortChange(key),
      });
    }

    requestCurrentLocation() {
      if (!navigator.geolocation) {
        this.useFallbackLocation("Geolocation API 미지원: 임시 위치 사용 중");
        return;
      }

      this.view.setLocationLoading(true);
      this.view.renderLocationStatus("현재 위치 확인 중");
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.view.setLocationLoading(false);
          this.applyGeolocationPosition(position, "현재 위치 갱신 완료");
        },
        (error) => {
          this.view.setLocationLoading(false);
          this.handleGeolocationError(error);
        },
        GEOLOCATION_OPTIONS
      );
    }

    startLocationWatch() {
      if (!navigator.geolocation || this.watchId !== null) return;

      this.watchId = navigator.geolocation.watchPosition(
        (position) => this.applyGeolocationPosition(position, "GPS 수신 중"),
        () => {},
        GEOLOCATION_OPTIONS
      );
    }

    applyGeolocationPosition(position, statusText) {
      const { latitude, longitude, accuracy } = position.coords;
      this.model.setCurrentLocation({
        lat: latitude,
        lng: longitude,
        accuracy,
      });
      this.view.renderLocationStatus(statusText);
      this.updateLocationViews();
    }

    handleGeolocationError(error) {
      const messages = {
        1: "위치 권한 필요: 임시 위치 사용 중",
        2: "위치 확인 실패: 임시 위치 사용 중",
        3: "위치 확인 시간 초과: 임시 위치 사용 중",
      };
      this.useFallbackLocation(messages[error.code] || "GPS 확인 실패: 임시 위치 사용 중");
    }

    useFallbackLocation(message) {
      if (!this.model.currentLocation) {
        this.model.setCurrentLocation(FALLBACK_LOCATION);
      }
      this.view.renderLocationStatus(message);
      this.updateLocationViews();
    }

    handleMeasurementModeChange(mode) {
      this.model.setMeasurementMode(mode);
      this.activePoint = mode === "manual" ? "start" : "end";
      this.view.renderMeasurementMode({
        mode: this.model.measurementMode,
        activePoint: this.activePoint,
      });
      this.updateLocationViews();
    }

    handlePointTargetChange(point) {
      this.activePoint = point === "start" ? "start" : "end";
      this.view.renderMeasurementMode({
        mode: this.model.measurementMode,
        activePoint: this.activePoint,
      });
    }

    handleDestinationSelect(location) {
      if (this.model.measurementMode === "manual" && this.activePoint === "start") {
        this.model.setManualStartLocation(location);
        this.activePoint = "end";
        this.view.renderMeasurementMode({
          mode: this.model.measurementMode,
          activePoint: this.activePoint,
        });
        this.updateLocationViews();
        return;
      }

      if (!this.model.currentLocation) {
        this.view.showAlert(
          this.model.measurementMode === "manual"
            ? "지도에서 시작점을 먼저 선택하세요."
            : "현재 위치를 먼저 확인하세요."
        );
        return;
      }

      this.model.setEndLocation(location);
      this.updateLocationViews();
    }

    async handleSaveMeasurement() {
      const formData = this.view.getFormData();

      if (!this.model.currentLocation) {
        this.view.showAlert(
          this.model.measurementMode === "manual"
            ? "지도에서 시작점을 먼저 선택하세요."
            : "현재 위치를 먼저 확인하세요."
        );
        return;
      }

      if (!this.model.endLocation) {
        this.view.showAlert("지도에서 측정점을 먼저 선택하세요.");
        return;
      }

      if (!formData.actualDistance) {
        this.view.showAlert("실제 측량값을 입력하세요.");
        return;
      }

      try {
        await this.model.saveMeasurement(formData);
        this.view.resetFormAfterSave();
        this.view.renderSyncStatus(this.model.getPersistenceStatus());
        this.renderAll();
      } catch (error) {
        this.view.renderSyncStatus(this.model.getPersistenceStatus());
        this.view.showAlert(error.message);
      }
    }

    handleCsvDownload() {
      if (!this.model.measurements.length) {
        this.view.showAlert("다운로드할 측정 데이터가 없습니다.");
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      this.view.downloadFile(`gps-measurements-${today}.csv`, this.model.toCsv());
    }

    handleDeleteMeasurement(id) {
      if (!this.model.canDeleteMeasurements()) {
        this.view.showAlert("외부 공유 저장 모드에서는 앱에서 직접 삭제하지 않습니다. 삭제는 연결된 저장소에서 관리하세요.");
        return;
      }

      const shouldDelete = window.confirm("이 측정 데이터를 삭제할까요?");
      if (!shouldDelete) return;

      this.model.deleteMeasurement(id);
      this.renderAll();
    }

    handleSortChange(key) {
      if (this.sortState.key === key) {
        this.sortState.direction = this.sortState.direction === "asc" ? "desc" : "asc";
      } else {
        this.sortState.key = key;
        this.sortState.direction = key === "timestamp" ? "desc" : "asc";
      }
      this.renderMeasurements();
    }

    updateLocationViews() {
      this.view.renderGpsAccuracy(this.model.gpsAccuracy);
      this.view.renderLocation({
        currentLocation: this.model.currentLocation,
        endLocation: this.model.endLocation,
        gpsDistance: this.model.gpsDistance,
      });
      this.view.updateMap({
        currentLocation: this.model.currentLocation,
        endLocation: this.model.endLocation,
        gpsLocation: this.model.gpsLocation,
        measurementMode: this.model.measurementMode,
      });
    }

    renderAll() {
      this.updateLocationViews();
      this.view.renderSummary(this.model.getSummary());
      this.renderMeasurements();
      this.view.renderCharts(this.getChronologicalMeasurements(), this.model.getEnvironmentAverages());
    }

    renderMeasurements() {
      this.view.renderMeasurements(this.getSortedMeasurements(), this.sortState, {
        canDelete: this.model.canDeleteMeasurements(),
        storageLabel: this.model.persistenceMode === "sheets" ? "시트 보관" : "DB 보관",
      });
    }

    getChronologicalMeasurements() {
      return [...this.model.measurements].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    getSortedMeasurements() {
      const direction = this.sortState.direction === "asc" ? 1 : -1;
      const key = this.sortState.key;

      return [...this.model.measurements].sort((a, b) => {
        let first = a[key];
        let second = b[key];

        if (key === "timestamp") {
          first = new Date(first).getTime();
          second = new Date(second).getTime();
        }

        if (typeof first === "string") {
          return first.localeCompare(second, "ko-KR") * direction;
        }

        return (Number(first) - Number(second)) * direction;
      });
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    const model = new window.MeasurementModel();
    const view = new window.AppView();
    const controller = new AppController(model, view);
    controller.init();
    window.gpsSurveyApp = controller;
  });
})();
