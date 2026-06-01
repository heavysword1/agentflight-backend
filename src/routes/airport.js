const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 86400 });

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const AERO_HOST = 'aerodatabox.p.rapidapi.com';

router.get('/', async (req, res) => {
  try {
    const iata = (req.query.iata || 'JFK').toUpperCase();

    // Check cache
    const cached = cache.get(iata);
    if (cached) return res.json(cached);

    // Call AeroDataBox API
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

    cache.set(iata, result);
    res.json(result);
  } catch (err) {
    console.error('Airport fetch error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
