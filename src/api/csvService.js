const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const DATA_DIR = path.join(__dirname, '../../data');

class DataService {
  constructor() {
    this.history = [];
    this.opens = [];
    this.clicks = [];
    this.isLoaded = false;
    this.maxDate = 0;
  }

  async loadData() {
    console.log('Loading CSV data into memory...');
    const [_h, _o, _c, _u, _b, _j] = await Promise.all([
      this.parseCSV(path.join(DATA_DIR, 'Journey_History.csv')),
      this.parseCSV(path.join(DATA_DIR, 'Opens.csv')),
      this.parseCSV(path.join(DATA_DIR, 'Clicks.csv')),
      this.parseCSV(path.join(DATA_DIR, 'Unsubscribes.csv')),
      this.parseCSV(path.join(DATA_DIR, 'Bounces.csv')),
      this.parseCSV(path.join(DATA_DIR, 'Journey_Send.csv'))
    ]);
    this.history = _h;
    this.opens = _o;
    this.clicks = _c;
    this.unsubscribes = _u;
    this.bounces = _b;
    
    this.versionMap = {};
    this.activityMap = {};
    this.sendDefToActivityName = {}; // TriggererSendDefinitionObjectID → ActivityName
    this.journeyEntries = _j;        // raw Journey_Send rows for subscriber counting

    // Build JourneyID → VersionID map (Journey_Send JourneyID may differ from VersionID/DefinitionId)
    // DefinitionId in history == VersionID in Journey_Send, but SFMC API item.id may be JourneyID
    this.journeyIdToVersionId = {};
    for (const r of _j) {
        if (r.VersionID && r.VersionNumber) {
            this.versionMap[r.VersionID.toLowerCase()] = r.VersionNumber;
        }
        if (r.ActivityID && r.TriggererSendDefinitionObjectID) {
            this.activityMap[r.ActivityID.toLowerCase()] = r.TriggererSendDefinitionObjectID.toLowerCase();
        }
        if (r.TriggererSendDefinitionObjectID && r.ActivityName) {
            this.sendDefToActivityName[r.TriggererSendDefinitionObjectID.toLowerCase()] = r.ActivityName;
        }
        if (r.JourneyID && r.VersionID) {
            const jid = r.JourneyID.trim().toLowerCase();
            const vid = r.VersionID.trim().toLowerCase();
            if (jid !== vid) this.journeyIdToVersionId[jid] = vid;
        }
    }

    // Load SFMC journey data from cached CSV — matched by id only
    const sfmcRows = await this.parseCSV(path.join(DATA_DIR, 'sfmc-journeys.csv'));
    this._buildSfmcLookup(sfmcRows);

    this.isLoaded = true;

    this.minDate = Infinity;
    this.maxDate = 0;

    // Find the absolute min/max dates to serve as anchors for full representation
    for (const r of this.history) {
      if(!r.TransactionTime) continue;
      const t = new Date(r.TransactionTime).getTime();
      if (t > this.maxDate) this.maxDate = t;
      if (t < this.minDate) this.minDate = t;
    }
    for (const r of Object.values({o:this.opens, c:this.clicks, b:this.bounces}).flat()) {
      const t = this.parseSFMCDate(r.EventDate);
      if(t===0) continue;
      if (t > this.maxDate) this.maxDate = t;
      if (t < this.minDate) this.minDate = t;
    }
    
    if (this.minDate === Infinity) this.minDate = 0;

    console.log(`Loaded ${this.history.length} history events, max date is ${new Date(this.maxDate).toISOString()}`);
  }

  async reloadSfmcLookup() {
    const sfmcRows = await this.parseCSV(path.join(DATA_DIR, 'sfmc-journeys.csv'));
    this._buildSfmcLookup(sfmcRows);
    console.log(`SFMC lookup reloaded: ${Object.keys(this.sfmcLookup).length} entries`);
  }

  _buildSfmcLookup(sfmcRows) {
    const lookup = {};
    let totalJourneys = null;
    let activeJourneys = null;

    if (sfmcRows.length > 0) {
      totalJourneys = sfmcRows.length;
      activeJourneys = sfmcRows.filter(
        r => (r['status'] || '').trim().toLowerCase() === 'published'
      ).length;
    }

    for (const row of sfmcRows) {
      const id = (row['id'] || '').trim().toLowerCase();
      if (!id) continue;
      const entry = {
        modifiedDate: row['modifiedDate'] || null,
        population: row['Population'] != null && row['Population'] !== '' ? Number(row['Population']) : null,
        status: row['status'] || null
      };
      // Index by the id as-is (works when SFMC item.id == DefinitionId/VersionID)
      lookup[id] = entry;
      // Also index by the mapped VersionID (works when SFMC item.id == JourneyID)
      const versionId = (this.journeyIdToVersionId || {})[id];
      if (versionId) lookup[versionId] = entry;
    }

    this.sfmcLookup = lookup;
    this.sfmcStats = { totalJourneys, activeJourneys };
  }

  parseCSV(filePath) {
    return new Promise((resolve, reject) => {
      const results = [];
      if (!fs.existsSync(filePath)) {
         console.warn(`File not found: ${filePath}`);
         return resolve(results);
      }
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', (err) => reject(err));
    });
  }

  parseSFMCDate(str) {
    if (!str) return 0;
    const cleanStr = str.replace(/([apAP][mM])$/, ' $1');
    const t = new Date(cleanStr).getTime();
    return isNaN(t) ? 0 : t;
  }

  getJourneysDashboardData(startTs, endTs) {
    const summaryMap = {};
    
    // Global metrics accumulators
    let totalSends = 0;
    let emailStats = {}; // { activityName: { sent: 0, opens: 0, clicks: 0, pop: Set } }
    let errorStats = {}; // { activityName: errors }
    
    let contactStates = {}; 
    // { [contactKey]: { entered: false, exited: false, failed: false, start: ts, end: ts } }

    const filteredHistory = this.history.filter(r => {
        const t = new Date(r.TransactionTime).getTime();
        return t >= startTs && t <= endTs;
    });
    
    for (const row of filteredHistory) {
      if (!row.DefinitionId) continue;
      const key = row.DefinitionId;
      const t = new Date(row.TransactionTime).getTime();
      
      if (!summaryMap[key]) {
        summaryMap[key] = {
          journeyId: row.DefinitionId,
          versionId: row.DefinitionId,
          name: row.DefinitionName,
          version: this.versionMap[row.DefinitionId.toLowerCase()] || '1',
          population: new Set(),
          entries: 0,
          exits: 0,
          failed: 0,
          emailActivityIds: new Set(), // unique email step IDs — determines Multi-Step vs One-Off
          entryDates: new Set()
        };
      }
      
      if (row.ContactKey) {
        summaryMap[key].population.add(row.ContactKey);
        if (!contactStates[row.ContactKey]) {
           contactStates[row.ContactKey] = { entered: false, exited: false, failed: false };
        }
      }
      
      const c = row.ContactKey;
      if (row.ActivityType === 'StartInteractionActivity') {
        summaryMap[key].entries++;
        if (row.TransactionTime) {
             summaryMap[key].entryDates.add(new Date(row.TransactionTime).toISOString().split('T')[0]);
        }
        if(c) {
           contactStates[c].entered = true;
           contactStates[c].start = t;
        }
      }
      else if (row.ActivityType === 'StopInteractionActivity') {
        summaryMap[key].exits++;
        if(c) {
           contactStates[c].exited = true;
           contactStates[c].end = t;
        }
      }
      else if (row.ActivityType === 'EMAILV2') {
        totalSends++;
        if (!emailStats[row.ActivityName]) emailStats[row.ActivityName] = { sent:0, pop: new Set() };
        emailStats[row.ActivityName].sent++;
        if (c) emailStats[row.ActivityName].pop.add(c);
        // Track unique email activity IDs per journey for Multi-Step detection
        if (row.ActivityId) summaryMap[key].emailActivityIds.add(row.ActivityId);
      }
      
      if (row.Status === 'Failed') {
        if(c) contactStates[c].failed = true;
        summaryMap[key].failed++;
        // Track failures by journey name only — filter out missing/unknown names
        const jName = row.DefinitionName ? row.DefinitionName.trim() : '';
        if (jName) errorStats[jName] = (errorStats[jName] || 0) + 1;
      }
    }

    // Exclusively bucket Flow Stats
    let totalEntered = 0;
    let totalCompleted = 0;
    let totalFailed = 0;
    let totalActive = 0;
    
    let totalHours = 0;
    let completedJourneyTimes = 0;

    for (const c in contactStates) {
       const s = contactStates[c];
       if (s.entered) {
          totalEntered++;
          if (s.exited) {
              totalCompleted++;
              if (s.start && s.end && s.end >= s.start) {
                  totalHours += (s.end - s.start) / (1000 * 60 * 60);
                  completedJourneyTimes++;
              }
          } else if (s.failed) {
              totalFailed++;
          } else {
              totalActive++;
          }
       }
    }
    
    const avgHours = completedJourneyTimes > 0 ? (totalHours / completedJourneyTimes) : 0;

    const filteredOpens = this.opens.filter(r => {
        const t = this.parseSFMCDate(r.EventDate);
        return t >= startTs && t <= endTs;
    });
    const filteredClicks = this.clicks.filter(r => {
        const t = this.parseSFMCDate(r.EventDate);
        return t >= startTs && t <= endTs;
    });
    const filteredBounces = this.bounces.filter(r => {
        const t = this.parseSFMCDate(r.EventDate);
        return t >= startTs && t <= endTs;
    });

    const uniqueOpensSet = new Set(filteredOpens.map(o => o.SubscriberKey));
    const uniqueClicksSet = new Set(filteredClicks.map(c => c.SubscriberKey));
    const uniqueBouncesSet = new Set(filteredBounces.map(b => b.SubscriberKey));
    
    // Unsubscribes dataset has no EventDate based on current structure
    const allUnsubscribesSet = new Set(this.unsubscribes.map(u => u.SubscriberKey));

    let globalPopulation = new Set();
    let globalUnsubs = new Set();

    const journeys = Object.values(summaryMap).map(j => {
      let openCount = 0;
      let clickCount = 0;
      
      for (const contact of j.population) {
         globalPopulation.add(contact);
         if (uniqueOpensSet.has(contact)) openCount++;
         if (uniqueClicksSet.has(contact)) clickCount++;
         if (allUnsubscribesSet.has(contact)) globalUnsubs.add(contact);
      }

      const currentPop = j.population.size;
      // Multi-Step = more than one distinct email activity; One-Off = exactly one (or none)
      const type = j.emailActivityIds.size > 1 ? "Multi-Step" : "One-Off";
      const resolvedJTotal = j.exits + j.failed;
      const conversionRate = resolvedJTotal > 0 ? (j.exits / resolvedJTotal) * 100 : 0;

      const sfmcEntry = this.sfmcLookup[j.journeyId.toLowerCase()] || null;

      return {
        journeyId: j.journeyId,
        versionId: j.versionId,
        name: j.name,
        version: j.version,
        type: type,
        conversionRate: conversionRate,
        currentPopulation: currentPop,
        entries: j.entries,
        exits: j.exits,
        opensRate: currentPop > 0 ? (openCount / currentPop) * 100 : 0,
        clicksRate: currentPop > 0 ? (clickCount / currentPop) * 100 : 0,
        modifiedDate: sfmcEntry ? sfmcEntry.modifiedDate : null,
        sfmcCurrentPopulation: sfmcEntry ? sfmcEntry.population : null
      };
    }); // ... remainder of getting diagnostics untouched after globalPopulation is assembled

    // Populate best/worst emails
    Object.keys(emailStats).forEach(name => {
       let o = 0, c = 0;
       for (const contact of emailStats[name].pop) {
          if (uniqueOpensSet.has(contact)) o++;
          if (uniqueClicksSet.has(contact)) c++;
       }
       emailStats[name].openRate = emailStats[name].pop.size > 0 ? (o / emailStats[name].pop.size) * 100 : 0;
    });

    let bestEmail = "N/A";
    let worstEmail = "N/A";
    let highestRate = -1;
    let lowestRate = 101;
    
    Object.keys(emailStats).forEach(name => {
       if (emailStats[name].sent > 10) { 
          if (emailStats[name].openRate > highestRate) { highestRate = emailStats[name].openRate; bestEmail = name; }
          if (emailStats[name].openRate < lowestRate) { lowestRate = emailStats[name].openRate; worstEmail = name; }
       }
    });

    // Find journey with most failures (errorStats is now keyed by DefinitionName)
    let topFailingJourney = null;
    let maxErrors = 0;
    Object.keys(errorStats).forEach(name => {
       if (errorStats[name] > maxErrors) { maxErrors = errorStats[name]; topFailingJourney = name; }
    });

    // Build sorted list of all failing journeys for diagnostics
    const failingJourneys = Object.entries(errorStats)
      .sort((a, b) => b[1] - a[1])
      .map(([journey, failCount]) => ({ journey, failCount }));

    const resolvedTotal = totalCompleted + totalFailed;

    const flow = {
       totalJourneys: this.sfmcStats.totalJourneys,
       activeJourneys: this.sfmcStats.activeJourneys,
       uniqueEntered: totalEntered,
       uniqueExited: totalCompleted,
       active: totalActive,
       failedContacts: totalFailed,
       conversionRate: resolvedTotal > 0 ? (totalCompleted / resolvedTotal) * 100 : 0,
       failureRate: resolvedTotal > 0 ? (totalFailed / resolvedTotal) * 100 : 0,
    };

    let validOpensCount = 0;
    let validClicksCount = 0;
    let validBouncesCount = 0;
    let validUnsubsCount = 0;

    for (const contact of globalPopulation) {
        if (uniqueOpensSet.has(contact)) validOpensCount++;
        if (uniqueClicksSet.has(contact)) validClicksCount++;
        if (uniqueBouncesSet.has(contact)) validBouncesCount++;
        if (allUnsubscribesSet.has(contact)) validUnsubsCount++;
    }

    const engagement = {
       sent: totalSends,
       uniqueOpenRate: globalPopulation.size > 0 ? (validOpensCount / globalPopulation.size) * 100 : 0,
       uniqueClickRate: globalPopulation.size > 0 ? (validClicksCount / globalPopulation.size) * 100 : 0,
       ctor: validOpensCount > 0 ? (validClicksCount / validOpensCount) * 100 : 0,
       unsubscribe: globalPopulation.size > 0 ? (validUnsubsCount / globalPopulation.size) * 100 : 0,
       bounce: globalPopulation.size > 0 ? (validBouncesCount / globalPopulation.size) * 100 : 0
    };

    // Most bounced email by bounce RATE: bounces / sends for that activity
    const bounceByActivity = {};
    for (const r of filteredBounces) {
      const sendDefId = r.TriggererSendDefinitionObjectID ? r.TriggererSendDefinitionObjectID.toLowerCase() : null;
      if (!sendDefId) continue;
      const actName = this.sendDefToActivityName[sendDefId];
      if (!actName) continue;
      bounceByActivity[actName] = (bounceByActivity[actName] || 0) + 1;
    }
    let mostBouncedEmail = null;
    let highestBounceRate = -1;
    Object.entries(bounceByActivity).forEach(([name, bounceCount]) => {
      const sends = emailStats[name] ? emailStats[name].sent : 0;
      if (sends < 5) return; // skip negligible sends
      const rate = (bounceCount / sends) * 100;
      if (rate > highestBounceRate) { highestBounceRate = rate; mostBouncedEmail = { name, bounceCount, sends, rate }; }
    });

    // Top emailed customer: from Journey_Send, count EMAILV2 rows per SubscriberKey in range
    const subEmailCount = {};
    for (const r of this.journeyEntries) {
      if (r.ActivityType !== 'EMAILV2') continue;
      const t = this.parseSFMCDate(r.EventDate);
      if (t < startTs || t > endTs) continue;
      const sk = r.SubscriberKey;
      if (!sk) continue;
      subEmailCount[sk] = (subEmailCount[sk] || 0) + 1;
    }
    let topEmailedCustomer = null;
    let topEmailCount = 0;
    Object.entries(subEmailCount).forEach(([sk, count]) => {
      if (count > topEmailCount) { topEmailCount = count; topEmailedCustomer = sk; }
    });

    const diagnostics = {
       mostBouncedEmail: mostBouncedEmail,
       topFailingJourney: topFailingJourney ? { journey: topFailingJourney, failCount: maxErrors } : null,
       topEmailedCustomer: topEmailedCustomer ? { subscriberKey: topEmailedCustomer, emailCount: topEmailCount } : null,
       failingJourneys
    };

    return { flow, engagement, diagnostics, journeys };
  }

  // Returns daily engagement counts (opens, clicks, entries) for the trend chart
  getTrendData(startTs, endTs) {
    const days = {};
    const addDay = (dateStr, key) => {
      if (!days[dateStr]) days[dateStr] = { date: dateStr, opens: 0, clicks: 0, entries: 0 };
      days[dateStr][key]++;
    };

    for (const r of this.history) {
      if (r.ActivityType !== 'StartInteractionActivity') continue;
      const t = new Date(r.TransactionTime).getTime();
      if (t < startTs || t > endTs) continue;
      const d = new Date(r.TransactionTime).toISOString().split('T')[0];
      addDay(d, 'entries');
    }
    for (const r of this.opens) {
      const t = this.parseSFMCDate(r.EventDate);
      if (t < startTs || t > endTs) continue;
      const d = new Date(t).toISOString().split('T')[0];
      addDay(d, 'opens');
    }
    for (const r of this.clicks) {
      const t = this.parseSFMCDate(r.EventDate);
      if (t < startTs || t > endTs) continue;
      const d = new Date(t).toISOString().split('T')[0];
      addDay(d, 'clicks');
    }

    return Object.values(days).sort((a, b) => a.date.localeCompare(b.date));
  }

  // Returns bounce breakdown by category + top smtp codes
  getBounceAnalysis(startTs, endTs) {
    const filtered = this.bounces.filter(r => {
      const t = this.parseSFMCDate(r.EventDate);
      return t >= startTs && t <= endTs;
    });

    const byCategory = {};
    const byCode = {};
    const bySubcategory = {};
    const trend = {};

    for (const r of filtered) {
      const cat = r.BounceCategory || 'Unknown';
      const sub = r.BounceSubcategory || 'Unknown';
      const code = r.SMTPCode || 'Unknown';
      const d = new Date(this.parseSFMCDate(r.EventDate)).toISOString().split('T')[0];

      byCategory[cat] = (byCategory[cat] || 0) + 1;
      bySubcategory[sub] = (bySubcategory[sub] || 0) + 1;
      byCode[code] = (byCode[code] || 0) + 1;
      if (!trend[d]) trend[d] = { date: d, hard: 0, soft: 0, unknown: 0 };
      const lc = cat.toLowerCase();
      if (lc.includes('hard')) trend[d].hard++;
      else if (lc.includes('soft')) trend[d].soft++;
      else trend[d].unknown++;
    }

    const topCodes = Object.entries(byCode)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([code, count]) => ({ code, count }));

    const topSubcategories = Object.entries(bySubcategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    return {
      total: filtered.length,
      byCategory: Object.entries(byCategory).map(([name, count]) => ({ name, count })),
      topSubcategories,
      topCodes,
      trend: Object.values(trend).sort((a, b) => a.date.localeCompare(b.date))
    };
  }

  // Returns top clicked links across all journeys
  getLinkPerformance(startTs, endTs) {
    const filtered = this.clicks.filter(r => {
      const t = this.parseSFMCDate(r.EventDate);
      return t >= startTs && t <= endTs;
    });

    const linkMap = {};
    for (const r of filtered) {
      // Shorten URL for display — strip tracking params after ?idcmp
      let url = r.URL || 'Unknown';
      const cutAt = url.indexOf('?idcmp');
      const displayUrl = cutAt > -1 ? url.substring(0, cutAt) : url;
      const name = r.LinkName || displayUrl;
      const key = name;

      if (!linkMap[key]) linkMap[key] = { name, url: displayUrl, total: 0, unique: 0, subscribers: new Set() };
      linkMap[key].total++;
      if (r.IsUnique === '1' || r.IsUnique === 1) linkMap[key].unique++;
      if (r.SubscriberKey) linkMap[key].subscribers.add(r.SubscriberKey);
    }

    const links = Object.values(linkMap)
      .map(l => ({ name: l.name, url: l.url, total: l.total, unique: l.unique, uniqueSubscribers: l.subscribers.size }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    // Engagement heatmap: day-of-week x hour-of-day from opens
    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of this.opens) {
      const t = this.parseSFMCDate(r.EventDate);
      if (t < startTs || t > endTs) continue;
      const d = new Date(t);
      heatmap[d.getDay()][d.getHours()]++;
    }

    return { links, heatmap };
  }

  getJourneyHistory(journeyId, startTs, endTs) {
    const events = this.history.filter(j => {
        const t = new Date(j.TransactionTime).getTime();
        return j.DefinitionId === journeyId && t >= startTs && t <= endTs;
    });
    
    if (!events.length) return null;
    
    const info = {
      journeyId,
      versionId: journeyId,
      name: events[0].DefinitionName,
      version: this.versionMap[journeyId.toLowerCase()] || '1',
      activities: {}
    };

    for (const evt of events) {
      if (!info.activities[evt.ActivityId]) {
        info.activities[evt.ActivityId] = {
          activityId: evt.ActivityId,
          name: evt.ActivityName,
          type: evt.ActivityType,
          population: new Set()
        };
      }
      info.activities[evt.ActivityId].population.add(evt.ContactKey);
    }

    const filteredOpens = this.opens.filter(r => {
        const t = this.parseSFMCDate(r.EventDate);
        return t >= startTs && t <= endTs && (r.IsUnique === '1' || r.IsUnique === 1);
    });
    const filteredClicks = this.clicks.filter(r => {
        const t = this.parseSFMCDate(r.EventDate);
        return t >= startTs && t <= endTs && (r.IsUnique === '1' || r.IsUnique === 1);
    });

    const actOpensSet = {};
    const actClicksSet = {};

    filteredOpens.forEach(o => {
        const aId = o.TriggererSendDefinitionObjectID ? o.TriggererSendDefinitionObjectID.toLowerCase() : null;
        if (!aId) return;
        if (!actOpensSet[aId]) actOpensSet[aId] = new Set();
        actOpensSet[aId].add(o.SubscriberKey);
    });

    filteredClicks.forEach(c => {
        const aId = c.TriggererSendDefinitionObjectID ? c.TriggererSendDefinitionObjectID.toLowerCase() : null;
        if (!aId) return;
        if (!actClicksSet[aId]) actClicksSet[aId] = new Set();
        actClicksSet[aId].add(c.SubscriberKey);
    });

    Object.values(info.activities).forEach(act => {
      let openCount = 0;
      let clickCount = 0;
      
      const resolvedId = this.activityMap[act.activityId] || act.activityId;
      const activityOpens = actOpensSet[resolvedId] || new Set();
      const activityClicks = actClicksSet[resolvedId] || new Set();

      for (const contact of act.population) {
         if (activityOpens.has(contact)) openCount++;
         if (activityClicks.has(contact)) clickCount++;
      }

      act.populationCount = act.population.size;
      act.openRate = act.populationCount > 0 ? (openCount / act.populationCount) * 100 : 0;
      act.clickRate = act.populationCount > 0 ? (clickCount / act.populationCount) * 100 : 0;
      act.uniqueOpens = openCount;
      act.uniqueClicks = clickCount;
      delete act.population;
    });

    info.activitiesList = Object.values(info.activities);
    delete info.activities;

    return info;
  }
}

module.exports = new DataService();
