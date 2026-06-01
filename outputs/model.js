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
      this.clientIdStorageKey = `${storageKey}.clientId`;
      this.clientId = this.getOrCreateClientId();
      this.sessionCode = window.SURVEY_SESSION_CODE || "default";
      this.googleSheetsUrl = window.GOOGLE_SHEETS_WEB_APP_URL || "";
      this.supabaseClient = this.createSupabaseClient();
      this.persistenceMode = this.googleSheetsUrl ? "sheets" : this.supabaseClient ? "supabase" : "local";
      this.persistenceError = null;
      this.currentLocation = null;
      this.gpsAccuracy = null;
      this.endLocation = null;
      this.gpsDistance = null;
      this.measurements = this.loadMeasurements();
    }

    getOrCreateClientId() {
      const existing = localStorage.getItem(this.clientIdStorageKey);
      if (existing) return existing;

      const clientId =
        window.crypto?.randomUUID?.() ||
        `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(this.clientIdStorageKey, clientId);
      return clientId;
    }

    createSupabaseClient() {
      const url = window.SUPABASE_URL;
      const key = window.SUPABASE_PUBLISHABLE_KEY;

      if (!url || !key || !window.supabase?.createClient) {
        return null;
      }

      return window.supabase.createClient(url, key, {
        global: {
          headers: {
            "x-client-id": this.clientId,
          },
        },
      });
    }

    async initializePersistence() {
      if (this.googleSheetsUrl) {
        return this.getPersistenceStatus();
      }

      if (!this.supabaseClient) {
        return this.getPersistenceStatus();
      }

      return this.fetchRemoteMeasurements();
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

    async saveMeasurement(input) {
      const measurement = this.createMeasurement(input);

      if (this.googleSheetsUrl) {
        await this.sendToGoogleSheets(measurement);
        this.persistenceMode = "sheets";
        this.persistenceError = null;
        this.measurements.push(measurement);
        this.persistMeasurements();
        return measurement;
      }

      if (this.supabaseClient) {
        const { data, error } = await this.supabaseClient
          .from("survey_measurements")
          .insert(this.toSupabaseRow(measurement))
          .select()
          .single();

        if (error) {
          this.persistenceMode = "error";
          this.persistenceError = error.message;
          throw new Error(`Supabase 저장 실패: ${error.message}`);
        }

        this.persistenceMode = "supabase";
        this.persistenceError = null;
        this.measurements.push(this.fromSupabaseRow(data));
        return measurement;
      }

      this.measurements.push(measurement);
      this.persistMeasurements();
      return measurement;
    }

    deleteMeasurement(id) {
      this.measurements = this.measurements.filter((item) => String(item.id) !== String(id));
      this.persistMeasurements();
    }

    async fetchRemoteMeasurements() {
      if (!this.supabaseClient) {
        return this.getPersistenceStatus();
      }

      const { data, error } = await this.supabaseClient
        .from("survey_measurements")
        .select("*")
        .eq("session_code", this.sessionCode)
        .order("recorded_at", { ascending: true });

      if (error) {
        this.persistenceMode = "error";
        this.persistenceError = error.message;
        return this.getPersistenceStatus();
      }

      this.measurements = data.map((row) => this.fromSupabaseRow(row));
      this.persistenceMode = "supabase";
      this.persistenceError = null;
      return this.getPersistenceStatus();
    }

    canDeleteMeasurements() {
      return this.persistenceMode !== "supabase" && this.persistenceMode !== "sheets";
    }

    getPersistenceStatus() {
      if (this.persistenceMode === "supabase") {
        return {
          mode: "supabase",
          label: "Supabase 연결됨",
          detail: `세션: ${this.sessionCode}`,
        };
      }

      if (this.persistenceMode === "sheets") {
        return {
          mode: "sheets",
          label: "Google Sheets 연결됨",
          detail: `세션: ${this.sessionCode}`,
        };
      }

      if (this.persistenceMode === "error") {
        return {
          mode: "error",
          label: "DB 연결 오류",
          detail: this.persistenceError,
        };
      }

      return {
        mode: "local",
        label: "로컬 저장소",
        detail: "Supabase 미설정",
      };
    }

    toSupabaseRow(measurement) {
      return {
        session_code: this.sessionCode,
        client_id: this.clientId,
        client_measurement_id: measurement.id,
        start_lat: measurement.startLocation.lat,
        start_lng: measurement.startLocation.lng,
        end_lat: measurement.endLocation.lat,
        end_lng: measurement.endLocation.lng,
        gps_distance_m: measurement.gpsDistance,
        actual_distance_m: measurement.actualDistance,
        absolute_error_m: measurement.absoluteError,
        relative_error_percent: measurement.relativeError,
        environment: measurement.environment,
        environment_key: measurement.environmentKey,
        gps_accuracy_m: measurement.gpsAccuracy,
        recorded_at: measurement.timestamp,
      };
    }

    async sendToGoogleSheets(measurement) {
      const payload = {
        sessionCode: this.sessionCode,
        clientId: this.clientId,
        clientMeasurementId: measurement.id,
        timestamp: measurement.timestamp,
        startLat: measurement.startLocation.lat,
        startLng: measurement.startLocation.lng,
        endLat: measurement.endLocation.lat,
        endLng: measurement.endLocation.lng,
        gpsDistance: measurement.gpsDistance,
        actualDistance: measurement.actualDistance,
        absoluteError: measurement.absoluteError,
        relativeError: measurement.relativeError,
        environment: measurement.environment,
        environmentKey: measurement.environmentKey,
        gpsAccuracy: measurement.gpsAccuracy,
      };

      try {
        await fetch(this.googleSheetsUrl, {
          method: "POST",
          mode: "no-cors",
          headers: {
            "Content-Type": "text/plain;charset=utf-8",
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        this.persistenceMode = "error";
        this.persistenceError = error.message;
        throw new Error(`Google Sheets 저장 실패: ${error.message}`);
      }
    }

    fromSupabaseRow(row) {
      return {
        id: row.id,
        startLocation: {
          lat: Number(row.start_lat),
          lng: Number(row.start_lng),
        },
        endLocation: {
          lat: Number(row.end_lat),
          lng: Number(row.end_lng),
        },
        gpsDistance: roundToTwo(Number(row.gps_distance_m)),
        actualDistance: roundToTwo(Number(row.actual_distance_m)),
        absoluteError: roundToTwo(Number(row.absolute_error_m)),
        relativeError: roundToTwo(Number(row.relative_error_percent)),
        environment: row.environment,
        environmentKey: row.environment_key,
        gpsAccuracy:
          row.gps_accuracy_m === null || row.gps_accuracy_m === undefined
            ? null
            : roundToTwo(Number(row.gps_accuracy_m)),
        timestamp: row.recorded_at || row.created_at,
        source: "supabase",
      };
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
