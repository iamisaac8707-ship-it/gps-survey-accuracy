(function () {
  "use strict";

  const STORAGE_KEY = "gpsSurveyMeasurements.v1";

  const ENVIRONMENTS = [
    { value: "open", label: "개활지" },
    { value: "urban", label: "도심지" },
    { value: "trees", label: "수목지" },
    { value: "shadow", label: "건물 음영" },
  ];

  function roundToTwo(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  function escapeCsv(value) {
    const stringValue = value === null || value === undefined ? "" : String(value);
    if (/[",\r\n]/.test(stringValue)) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  }

  class MeasurementModel {
    constructor(storageKey = STORAGE_KEY) {
      this.storageKey = storageKey;
      this.currentLocation = null;
      this.gpsAccuracy = null;
      this.endLocation = null;
      this.gpsDistance = null;
      this.measurements = this.loadMeasurements();
    }

    setCurrentLocation(location) {
      this.currentLocation = {
        lat: Number(location.lat),
        lng: Number(location.lng),
      };
      this.gpsAccuracy = Number.isFinite(Number(location.accuracy))
        ? roundToTwo(Number(location.accuracy))
        : null;
      this.recalculateGpsDistance();
      return this.currentLocation;
    }

    setEndLocation(location) {
      this.endLocation = {
        lat: Number(location.lat),
        lng: Number(location.lng),
      };
      return this.recalculateGpsDistance();
    }

    recalculateGpsDistance() {
      if (!this.currentLocation || !this.endLocation) {
        this.gpsDistance = null;
        return null;
      }
      this.gpsDistance = this.calculateDistance(this.currentLocation, this.endLocation);
      return this.gpsDistance;
    }

    calculateDistance(startLocation, endLocation) {
      const earthRadiusMeters = 6371000;
      const lat1 = toRadians(startLocation.lat);
      const lat2 = toRadians(endLocation.lat);
      const deltaLat = toRadians(endLocation.lat - startLocation.lat);
      const deltaLng = toRadians(endLocation.lng - startLocation.lng);

      const a =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return roundToTwo(earthRadiusMeters * c);
    }

    calculateErrors(gpsDistance, actualDistance) {
      const absoluteError = roundToTwo(Math.abs(gpsDistance - actualDistance));
      const relativeError = roundToTwo((absoluteError / actualDistance) * 100);
      return { absoluteError, relativeError };
    }

    createMeasurement({ actualDistance, environment }) {
      if (!this.currentLocation) {
        throw new Error("현재 위치가 설정되지 않았습니다.");
      }
      if (!this.endLocation || this.gpsDistance === null) {
        throw new Error("지도에서 목적지를 선택하세요.");
      }

      const numericActualDistance = Number(actualDistance);
      if (!Number.isFinite(numericActualDistance) || numericActualDistance <= 0) {
        throw new Error("실제 측량값을 0보다 큰 숫자로 입력하세요.");
      }

      const environmentMeta =
        ENVIRONMENTS.find((item) => item.value === environment) || ENVIRONMENTS[0];
      const roundedActualDistance = roundToTwo(numericActualDistance);
      const errors = this.calculateErrors(this.gpsDistance, roundedActualDistance);

      return {
        id: Date.now(),
        startLocation: { ...this.currentLocation },
        endLocation: { ...this.endLocation },
        gpsDistance: this.gpsDistance,
        actualDistance: roundedActualDistance,
        absoluteError: errors.absoluteError,
        relativeError: errors.relativeError,
        environment: environmentMeta.label,
        environmentKey: environmentMeta.value,
        gpsAccuracy: this.gpsAccuracy,
        timestamp: new Date().toISOString(),
      };
    }

    saveMeasurement(input) {
      const measurement = this.createMeasurement(input);
      this.measurements.push(measurement);
      this.persistMeasurements();
      return measurement;
    }

    deleteMeasurement(id) {
      const numericId = Number(id);
      this.measurements = this.measurements.filter((item) => item.id !== numericId);
      this.persistMeasurements();
    }

    loadMeasurements() {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        console.warn("측정 데이터 불러오기 실패:", error);
        return [];
      }
    }

    persistMeasurements() {
      localStorage.setItem(this.storageKey, JSON.stringify(this.measurements));
    }

    getEnvironmentAverages() {
      const grouped = ENVIRONMENTS.map((environment) => {
        const rows = this.measurements.filter((item) => item.environmentKey === environment.value);
        const total = rows.reduce((sum, item) => sum + Number(item.absoluteError || 0), 0);
        return {
          label: environment.label,
          value: rows.length ? roundToTwo(total / rows.length) : 0,
        };
      });

      return {
        labels: grouped.map((item) => item.label),
        data: grouped.map((item) => item.value),
      };
    }

    getSummary() {
      if (!this.measurements.length) {
        return {
          count: 0,
          averageRelativeError: null,
          maxAbsoluteError: null,
        };
      }

      const averageRelativeError = roundToTwo(
        this.measurements.reduce((sum, item) => sum + Number(item.relativeError || 0), 0) /
          this.measurements.length
      );
      const maxAbsoluteError = roundToTwo(
        Math.max(...this.measurements.map((item) => Number(item.absoluteError || 0)))
      );

      return {
        count: this.measurements.length,
        averageRelativeError,
        maxAbsoluteError,
      };
    }

    toCsv(rows = this.measurements) {
      const headers = [
        "id",
        "timestamp",
        "start_lat",
        "start_lng",
        "end_lat",
        "end_lng",
        "gps_distance_m",
        "actual_distance_m",
        "absolute_error_m",
        "relative_error_percent",
        "environment",
        "gps_accuracy_m",
      ];

      const body = rows.map((item) => [
        item.id,
        item.timestamp,
        item.startLocation?.lat,
        item.startLocation?.lng,
        item.endLocation?.lat,
        item.endLocation?.lng,
        item.gpsDistance,
        item.actualDistance,
        item.absoluteError,
        item.relativeError,
        item.environment,
        item.gpsAccuracy ?? "",
      ]);

      return `\ufeff${[headers, ...body].map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
    }
  }

  window.MeasurementModel = MeasurementModel;
  window.MeasurementConstants = {
    ENVIRONMENTS,
    roundToTwo,
  };
})();
