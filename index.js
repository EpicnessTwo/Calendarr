require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const ICAL = require('ical.js');
const NodeCache = require('node-cache');

const app = express();
const PORT = 9999;
const cache = new NodeCache({ stdTTL: 600 }); // Cache TTL set to 10 minutes
const dbPath = path.join(__dirname, 'events.db');
const dbExists = fs.existsSync(dbPath);
const db = new sqlite3.Database(dbPath);

const SONARR_ICS = process.env.SONARR_ICS;
const RADARR_ICS = process.env.RADARR_ICS;
const HTML_FILE_PATH = path.join(__dirname, 'index.html');

console.log('Starting...');
console.log('Sonarr ICS URL:', SONARR_ICS);
console.log('Radarr ICS URL:', RADARR_ICS);

// Initialize SQLite database only if it doesn't already exist
if (!dbExists) {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT,
          start TEXT,
          end TEXT,
          color TEXT,
          description TEXT,
          location TEXT
        )`);
        console.log('Database initialized.');
    });
} else {
    console.log('Database already exists. Skipping initialization.');
}

async function fetchWithRetries(url, retries = 3, delay = 10000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`Fetching data from ${url} (Attempt ${attempt})`);
            const response = await axios.get(url);
            return response.data;
        } catch (error) {
            console.error(`Attempt ${attempt} failed:`, error.message);
            if (attempt < retries) {
                await new Promise(res => setTimeout(res, delay));
            } else {
                throw new Error(`Failed to fetch data from ${url} after ${retries} attempts`);
            }
        }
    }
}

async function fetchAndStoreEvents(url, prefix) {
    try {
        const icsData = await fetchWithRetries(url);
        const jcalData = ICAL.parse(icsData);
        const comp = new ICAL.Component(jcalData);
        const events = comp.getAllSubcomponents('vevent').map(vevent => {
            const event = new ICAL.Event(vevent);
            const status = vevent.getFirstPropertyValue('status');
            return {
                title: `[${prefix}] ` + event.summary,
                start: event.startDate.toString(),
                end: event.endDate.toString(),
                color: status === 'CONFIRMED' ? 'green' : 'red',
                description: event.description || '',
                location: event.location || ''
            };
        });

        let pendingOperations = events.length;
        const stmtInsert = db.prepare(`INSERT INTO events (title, start, end, color, description, location) VALUES (?, ?, ?, ?, ?, ?)`);
        const stmtUpdate = db.prepare(`UPDATE events SET color = ? WHERE title = ? AND start = ? AND end = ?`);

        events.forEach(event => {
            db.get(
                `SELECT * FROM events WHERE title = ? AND start = ? AND end = ?`,
                [event.title, event.start, event.end],
                (err, row) => {
                    if (err) {
                        console.error('Database error:', err);
                    } else if (row) {
                        console.log('Updating existing event:', event.title);
                        stmtUpdate.run(event.color, event.title, event.start, event.end);
                    } else {
                        console.log('Inserting new event:', event.title);
                        stmtInsert.run(event.title, event.start, event.end, event.color, event.description, event.location);
                    }
                    pendingOperations--;
                    if (pendingOperations === 0) {
                        stmtInsert.finalize();
                        stmtUpdate.finalize();
                    }
                }
            );
        });

        if (pendingOperations === 0) {
            stmtInsert.finalize();
            stmtUpdate.finalize();
        }
    } catch (error) {
        console.error('Error fetching and storing events:', error);
    }
}

// Check for new events on startup
(async () => {
    console.log('Fetching and storing events on startup...');
    await fetchAndStoreEvents(SONARR_ICS, 'Sonarr');
    await fetchAndStoreEvents(RADARR_ICS, 'Radarr');
})();

// Periodic event crawler
setInterval(() => {
    fetchAndStoreEvents(SONARR_ICS, 'Sonarr');
    fetchAndStoreEvents(RADARR_ICS, 'Radarr');
}, 60000); // Every 1 minute

// Unified JSON feed
app.get('/events.json', (req, res) => {
    const { start, end } = req.query;

    if (!start || !end) {
        return res.status(400).json({ error: 'Start and end query parameters are required' });
    }

    const cacheKey = `${start}_${end}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
        console.log('Returning cached events for period:', start, end);
        return res.json(cachedData);
    }

    console.log('Fetching events for period:', start, end);

    db.all(
        `SELECT * FROM events WHERE start >= ? AND end <= ?`,
        [start, end],
        (err, rows) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).send('Failed to fetch events');
            }

            cache.set(cacheKey, rows);
            res.json(rows);
        }
    );
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
