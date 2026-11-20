/**
 * Tool definitions and implementations for Lunch Uncle.
 *
 * Each tool is split in two: a fetch function that talks to the network,
 * and a pure format function that shapes the response for the model.
 * The format functions are the ones covered by tests.
 */

// CT Hub 2, 114 Lavender Street.
export const CT_HUB_2 = { latitude: 1.31154, longitude: 103.86275 };

const SEARCH_RADIUS_METRES = 1000;
const MAX_PLACES = 10;
const FORECAST_AREA = "Kallang";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const FORECAST_URL =
  "https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast";
const BUS_URL = "https://arrivelah2.busrouter.sg/";

// Bounds each tool fetch so a hung upstream cannot stall the whole turn.
const TOOL_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Definitions sent to the model
// ---------------------------------------------------------------------------

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "find_lunch_places",
      description:
        "Search for places to eat near CT Hub 2. Returns name, rating, distance and whether it is open now.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'What to search for, e.g. "chicken rice", "japanese", "cheap lunch".',
          },
          open_now: {
            type: "boolean",
            description:
              "Only return places open at this moment. Set it only when the user wants to eat right now, not when asking about lunch later.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_rain_forecast",
      description:
        "Get the two-hour weather forecast for the Kallang area, which covers CT Hub 2.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bus_arrivals",
      description:
        "Get the next two arrivals per service at a Singapore bus stop, by five-digit stop code. next_min 0 means arriving now; next_live or subsequent_live false means a timetable estimate, not GPS.",
      parameters: {
        type: "object",
        properties: {
          stop_code: {
            type: "string",
            description:
              'Five-digit bus stop code as a string, keeping leading zeros, e.g. "07371".',
          },
        },
        required: ["stop_code"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Run one tool call requested by the model and return the result as a string.
 */
export async function executeTool(name, args, env) {
  const safeArgs =
    args && typeof args === "object" && !Array.isArray(args) ? args : {};
  try {
    switch (name) {
      case "find_lunch_places":
        return JSON.stringify(await findLunchPlaces(safeArgs, env));
      case "get_rain_forecast":
        return JSON.stringify(await getRainForecast());
      case "get_bus_arrivals":
        return JSON.stringify(await getBusArrivals(safeArgs));
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    const reason = err?.name === "TimeoutError" ? "timed out" : err?.message;
    console.error(`Tool ${name} failed:`, reason);
    return JSON.stringify({ error: `${name} failed: ${reason}` });
  }
}

// ---------------------------------------------------------------------------
// find_lunch_places
// ---------------------------------------------------------------------------

async function findLunchPlaces({ query, open_now = false }, env) {
  if (!env.GOOGLE_PLACES_API_KEY) {
    console.error("find_lunch_places: GOOGLE_PLACES_API_KEY is not set");
    return {
      error:
        "Place search is not configured, so no live results are available. Tell the user you cannot look up places right now.",
    };
  }

  const body = {
    textQuery: query,
    openNow: open_now,
    pageSize: MAX_PLACES,
    // A bias still lets far-away matches through; searchText restricts only by rectangle.
    locationRestriction: {
      rectangle: boundingBox(CT_HUB_2, SEARCH_RADIUS_METRES),
    },
  };

  const res = await fetch(PLACES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.rating,places.currentOpeningHours",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
  });

  if (!res.ok) {
    return { error: `Places API returned ${res.status}` };
  }

  const data = await res.json();
  return { places: formatPlaces(data.places ?? [], CT_HUB_2) };
}

/**
 * Shape Places API results into the fields Uncle needs.
 */
export function formatPlaces(places, origin) {
  return places.map(({ displayName, rating, location, currentOpeningHours }) => {
    const openNow = currentOpeningHours?.openNow;
    return {
      name: displayName?.text ?? "Unnamed",
      rating: rating ?? null,
      distance_m: location
        ? Math.round(haversineMetres(origin, location))
        : null,
      // null means Google has no hours for this place, which is not the same as closed.
      open_now: typeof openNow === "boolean" ? openNow : null,
    };
  });
}

/**
 * Rectangle reaching the given distance north, south, east and west of a point, as Places low/high corners.
 */
export function boundingBox(centre, metres) {
  const dLat = metres / 111320;
  const dLon = dLat / Math.cos((centre.latitude * Math.PI) / 180);
  return {
    low: { latitude: centre.latitude - dLat, longitude: centre.longitude - dLon },
    high: { latitude: centre.latitude + dLat, longitude: centre.longitude + dLon },
  };
}

/**
 * Great-circle distance between two {latitude, longitude} points, in metres.
 */
export function haversineMetres(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------
// get_rain_forecast
// ---------------------------------------------------------------------------

async function getRainForecast() {
  const res = await fetch(FORECAST_URL, {
    signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
  });
  if (!res.ok) {
    return { error: `Forecast API returned ${res.status}` };
  }
  return formatForecast(await res.json(), FORECAST_AREA);
}

/**
 * Pull one area's forecast out of the data.gov.sg two-hour forecast payload.
 */
export function formatForecast(payload, area) {
  const item = payload?.data?.items?.[0];
  if (!item) {
    return { error: "No forecast available" };
  }
  const entry = item.forecasts.find((f) => f.area === area);
  return {
    area,
    forecast: entry?.forecast ?? "Unknown",
    valid_period: item.valid_period?.text ?? null,
  };
}

// ---------------------------------------------------------------------------
// get_bus_arrivals
// ---------------------------------------------------------------------------

async function getBusArrivals({ stop_code }) {
  const code = normalizeStopCode(stop_code);
  if (!code) {
    return {
      error: `Invalid bus stop code "${stop_code}". Use the five-digit code, e.g. "07371".`,
    };
  }
  const res = await fetch(`${BUS_URL}?id=${code}`, {
    signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
  });
  if (!res.ok) {
    return { error: `Bus API returned ${res.status}` };
  }
  return formatBusArrivals(await res.json(), code);
}

/**
 * Return the five-digit stop code, or null if the input cannot be one.
 * Shorter all-digit codes are left-padded because models often pass "07371" as a number.
 */
export function normalizeStopCode(stopCode) {
  const code = String(stopCode ?? "").trim();
  return /^\d{1,5}$/.test(code) ? code.padStart(5, "0") : null;
}

/**
 * Reduce an arrivelah response to the next two arrivals per service.
 */
export function formatBusArrivals(payload, stopCode) {
  if (payload?.error) {
    return { error: payload.error };
  }
  const services = payload?.services ?? [];
  if (services.length === 0) {
    return {
      stop_code: stopCode,
      services: [],
      note: "No services found. The stop code may be wrong, or no buses are running now.",
    };
  }
  return {
    stop_code: stopCode,
    services: services.map((s) => {
      // A departed or missing next bus shifts the subsequent one forward.
      const [next, subsequent] = [s.next, s.subsequent]
        .map(toArrival)
        .filter(Boolean);
      return {
        service: s.no,
        next_min: next?.min ?? null,
        ...liveField("next_live", next),
        subsequent_min: subsequent?.min ?? null,
        ...liveField("subsequent_live", subsequent),
      };
    }),
  };
}

function toArrival(arrival) {
  const min = minutesFromNow(arrival);
  return min === null ? null : { min, live: liveFrom(arrival) };
}

function liveFrom(arrival) {
  return typeof arrival.monitored === "number" ? arrival.monitored === 1 : null;
}

function liveField(key, arrival) {
  return arrival && arrival.live !== null ? { [key]: arrival.live } : {};
}

/**
 * Whole minutes to arrival, 0 within about 30 s either way, null once the bus has gone.
 */
export function minutesFromNow(arrival) {
  if (!arrival || typeof arrival.duration_ms !== "number") {
    return null;
  }
  if (arrival.duration_ms < -30_000) {
    return null;
  }
  return Math.max(0, Math.round(arrival.duration_ms / 60000));
}
