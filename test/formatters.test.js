import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CT_HUB_2,
  formatForecast,
  formatBusArrivals,
  formatPlaces,
  haversineMetres,
  boundingBox,
  minutesFromNow,
  normalizeStopCode,
} from "../src/tools.js";

const forecastPayload = {
  data: {
    items: [
      {
        valid_period: {
          start: "2026-11-20T12:00:00+08:00",
          end: "2026-11-20T14:00:00+08:00",
          text: "Midday to 2 pm",
        },
        forecasts: [
          { area: "Geylang", forecast: "Fair" },
          { area: "Kallang", forecast: "Light Rain" },
        ],
      },
    ],
  },
};

test("formatForecast picks the requested area with its window in Singapore time", () => {
  const now = new Date("2026-11-20T12:30:00+08:00");

  assert.deepEqual(formatForecast(forecastPayload, "Kallang", now), {
    area: "Kallang",
    forecast: "Light Rain",
    valid_period: "Midday to 2 pm",
    valid_from: "12:00",
    valid_until: "14:00",
    now: "12:30",
    stale: false,
  });
});

test("formatForecast marks a forecast stale once its window has ended", () => {
  const now = new Date("2026-11-20T15:10:00+08:00");

  const result = formatForecast(forecastPayload, "Kallang", now);

  assert.equal(result.stale, true);
  assert.equal(result.valid_until, "14:00");
  assert.equal(result.now, "15:10");
});

test("formatForecast reports Unknown for an area not in the payload", () => {
  const now = new Date("2026-11-20T12:30:00+08:00");

  assert.equal(formatForecast(forecastPayload, "Tuas", now).forecast, "Unknown");
});

test("formatForecast returns an error when the payload has no forecasts", () => {
  const now = new Date("2026-11-20T12:30:00+08:00");

  assert.deepEqual(formatForecast({ data: { items: [{}] } }, "Kallang", now), {
    error: "No forecast available",
  });
  assert.deepEqual(formatForecast({ data: {} }, "Kallang", now), {
    error: "No forecast available",
  });
});

test("formatBusArrivals converts durations to whole minutes", () => {
  const payload = {
    services: [
      {
        no: "13",
        next: { duration_ms: 100_798 },
        subsequent: { duration_ms: 1_210_000 },
      },
      { no: "107M", next: { duration_ms: 30_000 }, subsequent: null },
    ],
  };

  assert.deepEqual(formatBusArrivals(payload, "07371"), {
    stop_code: "07371",
    services: [
      { service: "13", next_min: 2, subsequent_min: 20 },
      { service: "107M", next_min: 1, subsequent_min: null },
    ],
  });
});

test("formatBusArrivals passes an API error through instead of an empty list", () => {
  const payload = { error: "Invalid bus stop code.", statusCode: 400 };
  assert.deepEqual(formatBusArrivals(payload, "abcde"), {
    error: "Invalid bus stop code.",
  });
});

test("formatBusArrivals adds a note when the stop has no services", () => {
  const result = formatBusArrivals({ services: [] }, "99999");
  assert.equal(result.stop_code, "99999");
  assert.deepEqual(result.services, []);
  assert.match(result.note, /stop code may be wrong/);
});

test("formatBusArrivals reports live from monitored", () => {
  const payload = {
    services: [
      {
        no: "107",
        next: { duration_ms: 412_092, monitored: 1 },
        subsequent: { duration_ms: 1_686_092, monitored: 0 },
      },
    ],
  };
  assert.deepEqual(formatBusArrivals(payload, "07371").services, [
    {
      service: "107",
      next_min: 7,
      next_live: true,
      subsequent_min: 28,
      subsequent_live: false,
    },
  ]);
});

test("formatBusArrivals moves the subsequent bus up when next is gone", () => {
  const payload = {
    services: [
      {
        no: "13",
        next: { duration_ms: -120_000, monitored: 1 },
        subsequent: { duration_ms: 600_000, monitored: 1 },
      },
      { no: "21", next: null, subsequent: { duration_ms: 300_000 } },
    ],
  };
  assert.deepEqual(formatBusArrivals(payload, "07371").services, [
    { service: "13", next_min: 10, next_live: true, subsequent_min: null },
    { service: "21", next_min: 5, subsequent_min: null },
  ]);
});

test("minutesFromNow treats about 30 s either side of now as arriving", () => {
  assert.equal(minutesFromNow({ duration_ms: 29_999 }), 0);
  assert.equal(minutesFromNow({ duration_ms: -30_000 }), 0);
  assert.equal(minutesFromNow({ duration_ms: -30_001 }), null);
  assert.equal(minutesFromNow({ duration_ms: 90_000 }), 2);
  assert.equal(minutesFromNow(null), null);
  assert.equal(minutesFromNow({}), null);
});

test("normalizeStopCode pads short numeric codes and rejects the rest", () => {
  assert.equal(normalizeStopCode("07371"), "07371");
  assert.equal(normalizeStopCode("7371"), "07371");
  assert.equal(normalizeStopCode(7371), "07371");
  assert.equal(normalizeStopCode(" 07371 "), "07371");
  assert.equal(normalizeStopCode("abc"), null);
  assert.equal(normalizeStopCode("123456"), null);
  assert.equal(normalizeStopCode(""), null);
  assert.equal(normalizeStopCode(undefined), null);
});

test("haversineMetres measures CT Hub 2 to Lavender MRT at under 550 m", () => {
  const lavenderMrt = { latitude: 1.3073, longitude: 103.8631 };
  const distance = haversineMetres(CT_HUB_2, lavenderMrt);
  assert.ok(distance > 400 && distance < 550, `got ${distance}`);
});

test("formatPlaces measures distance from CT Hub 2, not Bedok", () => {
  const places = [
    {
      displayName: { text: "Next door" },
      rating: 4.2,
      location: { latitude: 1.3116, longitude: 103.863 },
    },
    {
      displayName: { text: "Bedok stall" },
      rating: 4.5,
      location: { latitude: 1.324, longitude: 103.927 },
    },
  ];

  const [nearby, bedok] = formatPlaces(places, CT_HUB_2);
  assert.ok(nearby.distance_m < 100, `got ${nearby.distance_m}`);
  assert.ok(bedok.distance_m > 7000, `got ${bedok.distance_m}`);
});

test("boundingBox edges sit the given distance from the centre", () => {
  const centre = { latitude: 1.3115, longitude: 103.8615 };
  const { low, high } = boundingBox(centre, 1000);
  assert.ok(low.latitude < high.latitude && low.longitude < high.longitude);
  const edges = [
    { latitude: low.latitude, longitude: centre.longitude },
    { latitude: high.latitude, longitude: centre.longitude },
    { latitude: centre.latitude, longitude: low.longitude },
    { latitude: centre.latitude, longitude: high.longitude },
  ];
  for (const edge of edges) {
    const d = haversineMetres(centre, edge);
    assert.ok(Math.abs(d - 1000) < 5, `got ${d}`);
  }
});

test("formatPlaces reports open, closed and unknown opening status", () => {
  const origin = { latitude: 1.3115, longitude: 103.8615 };
  const places = [
    {
      displayName: { text: "Open Stall" },
      rating: 4.2,
      location: origin,
      currentOpeningHours: { openNow: true },
    },
    {
      displayName: { text: "Closed Stall" },
      location: origin,
      currentOpeningHours: { openNow: false },
    },
    { displayName: { text: "No Hours Stall" }, location: origin },
  ];

  assert.deepEqual(
    formatPlaces(places, origin).map(({ name, open_now }) => ({ name, open_now })),
    [
      { name: "Open Stall", open_now: true },
      { name: "Closed Stall", open_now: false },
      { name: "No Hours Stall", open_now: null },
    ],
  );
});

test("formatPlaces gives a place without a location a null distance", () => {
  const origin = { latitude: 1.3115, longitude: 103.8615 };
  const places = [
    { displayName: { text: "No Pin Kopitiam" }, rating: 4.1 },
    {
      displayName: { text: "Lavender Food Square" },
      location: { latitude: 1.3073, longitude: 103.8631 },
    },
  ];

  const result = formatPlaces(places, origin);

  assert.deepEqual(result[0], {
    name: "No Pin Kopitiam",
    rating: 4.1,
    distance_m: null,
    open_now: null,
  });
  assert.equal(result[1].name, "Lavender Food Square");
  assert.equal(result[1].rating, null);
  assert.ok(result[1].distance_m > 400 && result[1].distance_m < 550);
});
