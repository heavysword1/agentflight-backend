const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 300 });

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const AERO_HOST = 'aerodatabox.p.rapidapi.com';

router.get('/', async (req, res) => {
  try {
    const airport = (req.query.airport || 'JFK').toUpperCase();
    const direction = (req.query.direction || 'Departure').toLowerCase() === 'arrival' ? 'Arrival' : 'Departure';
    let hours = parseInt(req.query.hours) || 6;
    
    // Validate hours
    if (hours < 1) hours = 1;
    if (hours > 12) hours = 12;

    // Check cache
    const cacheKey = `${airport}:${direction}:${hours}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

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

    // Call AeroDataBox API
    const url = `https://${AERO_HOST}/flights/airports/iata/${airport}/${from}/${to}`;
    const config = {
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': AERO_HOST
      },
      params: {
        withLeg: false,
        direction: direction,
        withCancelled: false,
        withCodeshared: false
      },
      timeout: 15000
    };

    const { data } = await axios.get(url, config);
    
    // Map flights
    const flights = (data.departures || data.arrivals || data || []).map(f => ({
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
      direction,
      from_time: from,
      to_time: to,
      count: flights.length,
      flights,
      source: 'AeroDataBox / RapidAPI'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Flight fetch error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
// Note: response handled in router.get above
