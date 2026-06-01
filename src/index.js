require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const express = require('express');
const cors = require('cors');
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { bazaarResourceServerExtension } = require('@x402/extensions');
const { ExactEvmScheme } = require('@x402/evm/exact/server');
const { HTTPFacilitatorClient } = require('@x402/core/server');

const flightsRouter = require('./routes/flights');
const airportRouter = require('./routes/airport');
const mcpRouter = require('./routes/mcp');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3032;
const PAY_TO = process.env.PAY_TO_ADDRESS || '0x24FAcafEB49b4e3FACF0B3e69604A2F4640c9bf2';
const X402_NETWORK = process.env.X402_NETWORK || 'eip155:8453';
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://x402.org/facilitator';

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'agentflight', port: PORT }));
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  res.json({ resource: 'https://flight.memoryapi.org/mcp', authorization_servers: [], bearer_methods_supported: [], resource_documentation: 'https://memoryapi.org' });
});
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.status(404).json({ error: 'No OAuth required.' });
});

app.use('/mcp', mcpRouter);

try {
  const { createFacilitatorConfig } = require('@coinbase/x402');
  const rawConfig = createFacilitatorConfig(process.env.CDP_API_KEY_NAME, process.env.CDP_API_KEY_PRIVATE_KEY);
  const facilitatorClient = new HTTPFacilitatorClient({ url: rawConfig.url, createAuthHeaders: rawConfig.createAuthHeaders });
  const x402Server = new x402ResourceServer(facilitatorClient)
    .register(X402_NETWORK, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  app.use(paymentMiddleware(
    {
      'GET /x402/flight/flights': {
        accepts: [{ scheme: 'exact', price: '$0.005', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Flight departures and arrivals from AeroDataBox. Real-time flight status, gate, terminal, and scheduling information.',
        extensions: { bazaar: { info: {
          description: 'Real-time flight departures and arrivals. Get scheduled times, status, gate/terminal info, and more.',
          input: { type: 'http', method: 'GET',
            queryParams: { airport: 'JFK', direction: 'Departure', hours: '6' },
            schema: { properties: {
              airport: { type: 'string', description: 'IATA airport code (default: JFK)', default: 'JFK' },
              direction: { type: 'string', description: 'Departure or Arrival (default: Departure)', default: 'Departure' },
              hours: { type: 'string', description: 'Look-ahead window in hours (1-12, default: 6)', default: '6' }
            }, required: [] }
          },
          output: { example: { success: true, airport: 'JFK', direction: 'Departure', from_time: '2026-06-01T03:00', to_time: '2026-06-01T09:00', count: 5, flights: [{ flight_number: 'BA114', airline: 'British Airways', destination: 'LHR', scheduled_time: '2026-06-01T05:30:00', status: 'Scheduled', terminal: 'T4', gate: 'B23' }] } }
        }}}
      },

      'GET /x402/flight/airport': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Airport information including IATA code, name, location, timezone, and coordinates.',
        extensions: { bazaar: { info: {
          description: 'Get airport information: name, city, country, timezone, and coordinates.',
          input: { type: 'http', method: 'GET',
            queryParams: { iata: 'JFK' },
            schema: { properties: {
              iata: { type: 'string', description: 'IATA airport code (default: JFK)', default: 'JFK' }
            }, required: [] }
          },
          output: { example: { success: true, iata: 'JFK', name: 'John F. Kennedy International Airport', city: 'New York', country: 'United States', timezone: 'America/New_York', coordinates: { latitude: 40.6413, longitude: -73.7781 } } }
        }}}
      }
    },
    x402Server,
    { afterSettle: (req, res, next, s) => { const e = s?.extensionResponses; if (e) console.log('[CDP] EXTENSION-RESPONSES:', JSON.stringify(e)); next(); } },
    null, true
  ));

  console.log('✅ x402 payment middleware registered');
} catch (err) {
  console.warn('⚠️  x402 middleware skipped:', err.message);
}

app.use('/x402/flight/flights', flightsRouter);
app.use('/x402/flight/airport', airportRouter);

app.listen(PORT, () => console.log(`AgentFlight running on port ${PORT}`));
