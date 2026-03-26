const fs = require('fs');
const path = require('path');
const axios = require('axios');

const EXPORT_PATH = path.join(__dirname, '../../data/sfmc-journeys.csv');
const PAGE_SIZE = 50;
const TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000;

class SfmcJourneyService {
  constructor() {
    this.accessToken = null;
    this.restInstanceUrl = null;
    this.tokenExpiresAt = 0;
  }

  isConfigured() {
    return Boolean(
      process.env.SFMC_AUTH_BASE_URL &&
      process.env.SFMC_CLIENT_ID &&
      process.env.SFMC_CLIENT_SECRET
    );
  }

  async getDashboardData() {
    const journeys = await this.fetchAllJourneys();
    this.writeExportFile(journeys);

    const publishedJourneys = journeys.filter((journey) => journey.status === 'Published');
    const totalCurrentPopulation = journeys.reduce(
      (sum, journey) => sum + journey.currentPopulation,
      0
    );

    return {
      inventory: {
        activeJourneys: publishedJourneys.length,
        totalJourneys: journeys.length,
        totalCurrentPopulation,
        publishedRate: journeys.length > 0 ? (publishedJourneys.length / journeys.length) * 100 : 0
      },
      journeys,
      exportFile: EXPORT_PATH
    };
  }

  async fetchAllJourneys() {
    const token = await this.getAccessToken();
    const allJourneys = [];
    let page = 1;
    let keepGoing = true;

    while (keepGoing) {
      const response = await axios.get(
        `${this.restInstanceUrl.replace(/\/$/, '')}/interaction/v1/interactions`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          params: {
            $page: page,
            $pageSize: PAGE_SIZE,
            $orderBy: 'modifiedDate DESC',
            extras: 'stats',
            mostRecentVersionOnly: true
          }
        }
      );

      const payload = response.data || {};
      const items = Array.isArray(payload.items) ? payload.items : [];
      const normalizedItems = items.map((item) => this.normalizeJourney(item));
      allJourneys.push(...normalizedItems);

      const totalCount = Number(
        payload.count ?? payload.totalCount ?? payload.totalResults ?? payload.total
      );
      if (Number.isFinite(totalCount) && totalCount > 0) {
        keepGoing = allJourneys.length < totalCount;
      } else {
        keepGoing = items.length === PAGE_SIZE;
      }

      page += 1;
    }

    return allJourneys;
  }

  async getAccessToken() {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.accessToken;
    }

    const authBaseUrl = process.env.SFMC_AUTH_BASE_URL.replace(/\/$/, '');
    const body = {
      grant_type: 'client_credentials',
      client_id: process.env.SFMC_CLIENT_ID,
      client_secret: process.env.SFMC_CLIENT_SECRET
    };

    if (process.env.SFMC_ACCOUNT_ID) {
      body.account_id = Number(process.env.SFMC_ACCOUNT_ID);
    }

    const response = await axios.post(`${authBaseUrl}/v2/token`, body, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const payload = response.data || {};
    if (!payload.access_token || !payload.rest_instance_url) {
      throw new Error('SFMC auth succeeded but did not return access_token and rest_instance_url');
    }

    this.accessToken = payload.access_token;
    this.restInstanceUrl = payload.rest_instance_url;
    this.tokenExpiresAt = now + (Number(payload.expires_in) || 1080) * 1000;

    return this.accessToken;
  }

  normalizeJourney(item) {
    const modifiedDate = item.modifiedDate || item.lastPublishedDate || item.createdDate || null;
    const status = item.status || 'Unknown';
    const currentPopulation = Number(item?.stats?.currentPopulation ?? 0);
    const version = item.versionNumber ?? item.version ?? item.workflowApiVersion ?? '';
    const journeyId = item.id || item.definitionId || item.key || item.name;

    return {
      journeyId,
      versionId: journeyId,
      key: item.key || '',
      name: item.name || 'Unnamed Journey',
      version: version === '' ? '' : String(version),
      status,
      currentPopulation: Number.isFinite(currentPopulation) ? currentPopulation : 0,
      modifiedDate,
      detailEnabled: false
    };
  }

  writeExportFile(journeys) {
    const header = ['id', 'Journey name', 'Population', 'modifiedDate', 'status'];
    const rows = journeys.map((journey) => [
      journey.journeyId || '',
      journey.name,
      String(journey.currentPopulation),
      journey.modifiedDate || '',
      journey.status
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((value) => this.escapeCsv(value)).join(','))
      .join('\n');

    fs.writeFileSync(EXPORT_PATH, `${csv}\n`, 'utf8');
  }

  escapeCsv(value) {
    const text = String(value ?? '');
    if (!/[",\n]/.test(text)) {
      return text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }
}

module.exports = new SfmcJourneyService();
