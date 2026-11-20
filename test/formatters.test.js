import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CT_HUB_2,
  formatForecast,
  formatBusArrivals,
  formatPlaces,
  haversineMetres,
  boundingBox,
} from "../src/tools.js";

test("formatForecast picks the requested area", () => {
  const payload = {
    data: {
      items: [
        {
          valid_period: { text: "12 pm to 2 pm" },
          forecasts: [
            { area: "Geylang", forecast: "Fair" },
            { area: "Kallang", forecast: "Light Rain" },
          ],
        },
      ],
    },
  };

  assert.deepEqual(formatForecast(payload, "Kallang"), {
    area: "Kallang",
    forecast: "Light Rain",
    valid_period: "12 pm to 2 pm",
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
