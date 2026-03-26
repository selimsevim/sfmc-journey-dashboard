require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const dataService = require('./src/api/csvService');
const sfmcJourneyService = require('./src/api/sfmcJourneyService');

const app = express();
const PORT = process.env.PORT || 3000;

function mergeSfmcJourneyFields(csvJourneys, sfmcJourneys) {
  // Index SFMC journeys by their journeyId (item.id from API = DefinitionId in history exports)
  const byId = new Map();
  sfmcJourneys.forEach((j) => {
    if (j.journeyId) byId.set(j.journeyId.toLowerCase(), j);
  });

  return csvJourneys.map((journey) => {
    const match = byId.get((journey.journeyId || '').toLowerCase());
    if (!match) return journey;
    return {
      ...journey,
      modifiedDate: match.modifiedDate || journey.modifiedDate,
      sfmcStatus: match.status || null,
      sfmcCurrentPopulation: match.currentPopulation ?? null
    };
  });
}

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let cachedSfmcData = null;

dataService.loadData().then(async () => {
  console.log('CSV Data loading complete. Server ready to handle requests.');
  if (sfmcJourneyService.isConfigured()) {
    try {
      cachedSfmcData = await sfmcJourneyService.getDashboardData();
      console.log('SFMC data loaded and cached at startup.');
      // Reload sfmcLookup now that sfmc-journeys.csv has been written with id column
      await dataService.reloadSfmcLookup();
    } catch (e) {
      console.warn('SFMC startup load failed:', e.message);
    }
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    if (!dataService.isLoaded) return res.status(503).json({ error: 'Data loading' });
    
    let endTs = req.query.end ? new Date(req.query.end).getTime() : dataService.maxDate;
    if (req.query.end) endTs += 24 * 60 * 60 * 1000 - 1; 

    // If no explicit start date is queried, default to the entire span of the CSV to populate metrics correctly
    let startTs = req.query.start ? new Date(req.query.start).getTime() : dataService.minDate;
    
    // Only cap logic at 30 if explicitly passed? The user requires restricting it overall to max 30 days IF picked,
    // but default UI expects fully loaded Opens/Clicks unless narrowed.
    // To strictly honor user "at most 30 days": 
    if (endTs - startTs > 30 * 24 * 60 * 60 * 1000 && req.query.start) {
       startTs = endTs - 30 * 24 * 60 * 60 * 1000;
    }

    const csvData = dataService.getJourneysDashboardData(startTs, endTs);

    if (cachedSfmcData) {
      const mergedJourneys = mergeSfmcJourneyFields(csvData.journeys, cachedSfmcData.journeys);
      return res.json({
        dashboardSource: 'sfmc',
        appliedDateRange: {
           start: new Date(startTs).toISOString().split('T')[0],
           end: new Date(endTs).toISOString().split('T')[0]
        },
        ...csvData,
        journeys: mergedJourneys,
        flow: {
          ...csvData.flow
        },
        exportFile: cachedSfmcData.exportFile,
        sfmcInventory: cachedSfmcData.inventory
      });
    }

    res.json({
      dashboardSource: 'csv',
      appliedDateRange: {
         start: new Date(startTs).toISOString().split('T')[0],
         end: new Date(endTs).toISOString().split('T')[0]
      },
      ...csvData
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

app.get('/api/journey/:journeyId/:versionId', async (req, res) => {
  try {
    const { journeyId } = req.params;
    if (!dataService.isLoaded) return res.status(503).json({ error: 'Data loading' });
    
    let endTs = req.query.end ? new Date(req.query.end).getTime() : dataService.maxDate;
    if (req.query.end) endTs += 24 * 60 * 60 * 1000 - 1; 

    let startTs = req.query.start ? new Date(req.query.start).getTime() : endTs - 30 * 24 * 60 * 60 * 1000;
    if (endTs - startTs > 30 * 24 * 60 * 60 * 1000) {
       startTs = endTs - 30 * 24 * 60 * 60 * 1000;
    }

    const data = dataService.getJourneyHistory(journeyId, startTs, endTs);
    if (!data) return res.status(404).json({ error: 'Journey not found' });
    
    res.json(data);
  } catch (err) {
    console.error("Journey History error:", err);
    res.status(500).json({ error: 'Failed to fetch journey history' });
  }
});

app.get('/api/trends', (req, res) => {
  try {
    if (!dataService.isLoaded) return res.status(503).json({ error: 'Data loading' });
    let endTs = req.query.end ? new Date(req.query.end).getTime() + 86399999 : dataService.maxDate;
    let startTs = req.query.start ? new Date(req.query.start).getTime() : dataService.minDate;
    res.json(dataService.getTrendData(startTs, endTs));
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/bounces', (req, res) => {
  try {
    if (!dataService.isLoaded) return res.status(503).json({ error: 'Data loading' });
    let endTs = req.query.end ? new Date(req.query.end).getTime() + 86399999 : dataService.maxDate;
    let startTs = req.query.start ? new Date(req.query.start).getTime() : dataService.minDate;
    res.json(dataService.getBounceAnalysis(startTs, endTs));
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/links', (req, res) => {
  try {
    if (!dataService.isLoaded) return res.status(503).json({ error: 'Data loading' });
    let endTs = req.query.end ? new Date(req.query.end).getTime() + 86399999 : dataService.maxDate;
    let startTs = req.query.start ? new Date(req.query.start).getTime() : dataService.minDate;
    res.json(dataService.getLinkPerformance(startTs, endTs));
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/journey', (req, res) => res.sendFile(path.join(__dirname, 'public/journey.html')));
app.get('/bounces', (req, res) => res.sendFile(path.join(__dirname, 'public/bounces.html')));
app.get('/links', (req, res) => res.sendFile(path.join(__dirname, 'public/links.html')));
app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, 'public/settings.html')));

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
