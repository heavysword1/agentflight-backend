const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const flightCache = new NodeCache({ stdTTL: 300 });
const airportCache = new NodeCache({ stdTTL: 86400 });

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const AERO_HOST = 'aerodatabox.p.rapidapi.com';

const TOOLS = [
  {
    name: 'get_flight_departures',
    description: 'Get flight departures from an airport. Returns flight number, airline, destination, scheduled time, status, gate, and terminal.',
    inputSchema: {
      type: 'object',
      properties: {
        airport: { type: 'string', description: 'IATA airport code (default: JFK)', default: 'JFK' },
        hours: { type: 'number', description: 'Look-ahead window in hours (1-12, default: 6)', default: 6, minimum: 1, maximum: 12 }
      }
    }
  },
  {
    name: 'get_airport_info',
    description: 'Get airport information including name, city, country, timezone, and coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        iata: { type: 'string', description: 'IATA airport code (default: JFK)', default: 'JFK' }
      }
    }
  }
];

async function getFlightDepartures(airport = 'JFK', hours = 6) {
  const cacheKey = `${airport}:Departure:${hours}`;
  const cached = flightCache.get(cacheKey);
  if (cached) return cached;

  // Validate hours
  if (hours < 1) hours = 1;
  if (hours > 12) hours = 12;

  // Build date range
  const now = new Date();
  const fromTime = new Date(now);
  const toTime = new Date(now.getTime() + hours * 60 * 60 * 1000);

  const formatTime = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${min}`;
  };

  const from = formatTime(fromTime);
  const to = formatTime(toTime);

  const url = `https://${AERO_HOST}/flights/airports/iata/${airport}/${from}/${to}`;
  const config = {
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': AERO_HOST
    },
    params: {
      withLeg: false,
      direction: 'Departure',
      withCancelled: false,
      withCodeshared: false
    },
    timeout: 15000
  };

  const { data } = await axios.get(url, config);
  
  const flights = (data || []).map(f => ({
    flight_number: f.number,
    airline: f.airline?.name,
    destination: f.movement?.airport?.iata,
    scheduled_time: f.movement?.scheduledTime?.local,
    status: f.movement?.quality?.[0],
    terminal: f.movement?.terminal,
    gate: f.movement?.gate
  }));

  const result = {
    success: true,
    airport,
    direction: 'Departure',
    from_time: from,
    to_time: to,
    count: flights.length,
    flights,
    source: 'AeroDataBox / RapidAPI'
  };

  flightCache.set(cacheKey, result);
  return result;
}

async function getAirportInfo(iata = 'JFK') {
  const cached = airportCache.get(iata);
  if (cached) return cached;

  const url = `https://${AERO_HOST}/airports/iata/${iata}`;
  const config = {
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': AERO_HOST
    },
    timeout: 15000
  };

  const { data } = await axios.get(url, config);

  const result = {
    success: true,
    iata: data.iata,
    name: data.name,
    city: data.city,
    country: data.country,
    timezone: data.timezone,
    coordinates: data.location && {
      latitude: data.location.latitude,
      longitude: data.location.longitude
    },
    source: 'AeroDataBox'
  };

  airportCache.set(iata, result);
  return result;
}

async function executeTool(name, args) {
  switch (name) {
    case 'get_flight_departures': {
      const { airport = 'JFK', hours = 6 } = args;
      return await getFlightDepartures(airport, hours);
    }
    case 'get_airport_info': {
      const { iata = 'JFK' } = args;
      return await getAirportInfo(iata);
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

router.get('/', (req, res) => {
  res.json({ name: 'AgentFlight', version: '1.0.0', transport: 'http', protocol: 'mcp', tools: TOOLS.map(t => t.name) });
});

router.post('/', async (req, res) => {
  const { method, params, id } = req.body;
  try {
    let result;
    switch (method) {
      case 'initialize':
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'AgentFlight', version: '1.0.0' } };
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call': {
        const { name, arguments: args = {} } = params;
        const toolResult = await executeTool(name, args);
        result = { content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }] };
        break;
      }
      default:
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
    }
    res.json({ jsonrpc: '2.0', id, result });
  } catch (err) {
    res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } });
  }
});

module.exports = router;
