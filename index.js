require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const ICAL = require('ical.js');
const NodeCache = require('node-cache');

const app = express();
const PORT = 9999;
const cache = new NodeCache({ stdTTL: 60 }); // Cache TTL set to 10 minutes

const SONARR_ICS = process.env.SONARR_ICS;
const RADARR_ICS = process.env.RADARR_ICS;
const HTML_FILE_PATH = path.join(__dirname, 'index.html');

console.log('Starting...');
console.log('Sonarr ICS URL:', SONARR_ICS);
console.log('Radarr ICS URL:', RADARR_ICS);

async function fetchWithCache(key, url) {
    const cachedData = cache.get(key);
    if (cachedData) {
        console.log(`Returning cached data for ${key}`);
        return cachedData;
    }

    console.log(`Fetching data for ${key}`);
    const response = await axios.get(url);
    cache.set(key, response.data);
    return response.data;
}

app.get('/sonarr.json', async (req, res) => {
    try {
        const icsData = await fetchWithCache('sonarr_json', SONARR_ICS);
        const jcalData = ICAL.parse(icsData);
        const comp = new ICAL.Component(jcalData);
        const events = comp.getAllSubcomponents('vevent').map(vevent => {
            const event = new ICAL.Event(vevent);
            const status = vevent.getFirstPropertyValue('status');
            return {
                title: '[Sonarr] ' + event.summary,
                start: event.startDate.toString(),
                end: event.endDate.toString(),
                color: status === 'CONFIRMED' ? 'green' : 'red',
                description: event.description || '',
                location: event.location || ''
            };
        });

        res.json(events);
    } catch (error) {
        console.error('Error converting ICS to JSON:', error);
        res.status(500).send('Failed to convert ICS to JSON');
    }
});

app.get('/radarr.json', async (req, res) => {
    try {
        const icsData = await fetchWithCache('radarr_json', RADARR_ICS);
        const jcalData = ICAL.parse(icsData);
        const comp = new ICAL.Component(jcalData);
        const events = comp.getAllSubcomponents('vevent').map(vevent => {
            const event = new ICAL.Event(vevent);
            const status = vevent.getFirstPropertyValue('status');
            return {
                title: '[Radarr] ' + event.summary,
                start: event.startDate.toString(),
                end: event.endDate.toString(),
                color: status === 'CONFIRMED' ? 'green' : 'red',
                description: event.description || '',
                location: event.location || ''
            };
        });

        res.json(events);
    } catch (error) {
        console.error('Error converting ICS to JSON:', error);
        res.status(500).send('Failed to convert ICS to JSON');
    }
});

// Serve the web calendar page
app.get('/', (req, res) => {
    if (fs.existsSync(HTML_FILE_PATH)) {
        res.sendFile(HTML_FILE_PATH);
    } else {
        res.status(404).send('HTML file not found');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
