const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const upload = multer({ storage: multer.memoryStorage() }); // Store files in memory for re-upload

const app = express();
const port = 3000;

app.use(cors()); // Allow requests from our frontend
app.use(express.json()); // Parse JSON bodies

// --- Database Connection ---
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: 5432,
});

// --- Schema Migration ---
const waitForDb = async () => {
  let retries = 5;
  while (retries) {
    try {
      const client = await pool.connect();
      client.release();
      console.log('Database connected successfully');
      return true;
    } catch (err) {
      console.log(`Database not ready, retrying in 5s... (${retries} left)`);
      retries -= 1;
      await new Promise(res => setTimeout(res, 5000));
    }
  }
  return false;
};

async function initializeDatabase() {
  if (!(await waitForDb())) {
    console.error('Could not connect to database after multiple retries.');
    // We exit here to let Docker restart the container, which is often better than hanging
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    console.log('Running database migrations...');

    // 1. Ensure 'users' table exists (basic check)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Check for missing columns and add them
    const checkColumn = async (tableName, columnName, columnDef) => {
      const res = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2
      `, [tableName, columnName]);

      if (res.rows.length === 0) {
        console.log(`Adding missing column '${columnName}' to '${tableName}'...`);
        await client.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
      }
    };

    // Ensure 'user_id' exists (Primary Key)
    // Note: If user_id is missing, we add it as SERIAL PRIMARY KEY.
    await checkColumn('users', 'user_id', 'SERIAL PRIMARY KEY');

    // Ensure 'phone_number' exists
    await checkColumn('users', 'phone_number', 'VARCHAR(50) NULL');

    // Ensure 'region' exists
    await checkColumn('users', 'region', 'VARCHAR(50) DEFAULT \'North America\'');

    // Ensure 'login_tokens' table exists
    // We do this AFTER ensuring users.user_id exists, because of the foreign key
    await client.query(`
      CREATE TABLE IF NOT EXISTS login_tokens (
        token_id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        token TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_user FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
    `);

    // Ensure index on token
    await client.query(`CREATE INDEX IF NOT EXISTS idx_token ON login_tokens(token);`);

    // Ensure 'sightings' table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS sightings (
        sighting_id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        species_name VARCHAR(255) NOT NULL,
        latitude DECIMAL(9, 6) NOT NULL,
        longitude DECIMAL(9, 6) NOT NULL,
        sighting_notes TEXT,
        sighting_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        photo_url TEXT,
        verification_status VARCHAR(50) DEFAULT 'unverified',
        region VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_sighting_user FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
    `);

    // Ensure 'region' exists in sightings
    await checkColumn('sightings', 'region', 'VARCHAR(50)');

    // Ensure index on sightings location
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sighting_location ON sightings(latitude, longitude);`);

    // Ensure 'user_preferences' table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        preference_id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        type VARCHAR(50) NOT NULL,
        value VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_preference_user FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        CONSTRAINT uq_user_preference UNIQUE(user_id, type, value)
      );
    `);

    // Ensure 'species_entries' table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS species_entries (
        entry_id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        species_name VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        habitat TEXT,
        fun_facts TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_entry_user FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
    `);

    console.log('Database migrations completed successfully.');

  } catch (err) {
    console.error('Migration failed:', err);
    // We don't exit process, but requests might fail if DB is bad.
  } finally {
    client.release();
  }
}

// --- API Endpoints ---

// Middleware to authenticate JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- Helper: Upload Image to ImgBB ---
async function uploadToImgBB(buffer) {
  if (!buffer) return null;
  try {
    const formData = new FormData();
    formData.append('image', buffer.toString('base64'));

    const response = await axios.post(`https://api.imgbb.com/1/upload`, formData, {
      params: {
        key: process.env.IMGBB_KEY,
      },
      headers: {
        ...formData.getHeaders(),
      },
    });

    if (response.data && response.data.data && response.data.data.url) {
      return response.data.data.url;
    } else {
      console.error('ImgBB response missing URL', response.data);
      return null;
    }
  } catch (error) {
    console.error('Error uploading to ImgBB:', error.message);
    if (error.response) console.error(error.response.data);
    return null;
  }
}

// 0. Species Lookup
app.get('/api/species', async (req, res) => {
  const { name, region } = req.query;
  if (!name) {
    return res.status(400).json({ message: 'Name parameter is required' });
  }

  try {
    const response = await axios.get('https://api.api-ninjas.com/v1/animals', {
      params: { name: name },
      headers: { 'X-Api-Key': process.env.API_NINJAS_KEY }
    });

    let data = response.data;

    // Filter by region if provided
    if (region && Array.isArray(data)) {
        // Normalize region string for comparison (e.g. "North America" -> "North-America" if API uses that format)
        // From API check: API uses "North-America", "South-America", "Africa", "Asia", "Europe", "Oceania"?
        // Wait, the API check earlier showed "North-America", "South-America", "Africa".
        // The user specified region list: "North America", "South America", etc.
        // We need to handle space vs dash.

        const targetRegion = region.replace(' ', '-'); // Simple heuristic

        data = data.filter(animal => {
            if (!animal.locations || !Array.isArray(animal.locations)) return false;
            return animal.locations.includes(targetRegion) || animal.locations.includes(region);
        });
    }

    res.json(data);
  } catch (error) {
    console.error('Error fetching species:', error.message);
    res.status(500).json({ message: 'Error fetching species data' });
  }
});

// 1. Register a new user
app.post('/register', async (req, res) => {
  const { username, phone_number, email, password, region } = req.body;

  if (!email || !password || !username) {
    return res.status(400).json({ message: 'Email, Username, and password are required' });
  }

  try {
    // Hash the password before storing it
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await pool.query(
      'INSERT INTO users (username, email, phone_number, password_hash, region) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [username, email, phone_number, passwordHash, region || 'North America']
    );

    res.status(201).json({
      message: 'User created successfully',
      user: {
        user_id: newUser.rows[0].user_id,
        username: newUser.rows[0].username,
        email: newUser.rows[0].email,
        region: newUser.rows[0].region,
      },
    });
  } catch (err) {
    if (err.code === '23505') { // Unique constraint violation
      return res.status(400).json({ message: 'Email already exists' });
    }
    if (err.constraint === 'users_username_key') {
         return res.status(400).json({ message: 'Username already exists' });
      }
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// 2. Login a user
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find the user by email
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = userResult.rows[0];

    // Check the password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Create a JSON Web Token (JWT)
    const token = jwt.sign(
      { userId: user.user_id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' } // Token expires in 1 hour
    );

    // Store the token in the database
    await pool.query(
      'INSERT INTO login_tokens (user_id, token) VALUES ($1, $2)',
      [user.user_id, token]
    );

    res.json({ message: 'Login successful', token: token, username: user.username, region: user.region || 'North America' });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// 3. Logout
app.post('/logout', (req, res) => {
    // In a stateless JWT setup, the client destroys the token.
    // If we were tracking active tokens in DB (blacklist), we would remove/invalidate it here.
    res.json({ message: 'Logged out successfully' });
});

// 4. Submit Sighting
app.post('/api/sightings', authenticateToken, upload.single('photo'), async (req, res) => {
  const { species_name, latitude, longitude, sighting_notes, sighting_date, region } = req.body;

  if (!species_name || !latitude || !longitude) {
    return res.status(400).json({ message: 'Species, latitude, and longitude are required.' });
  }

  // Validate Species
  try {
     const speciesRes = await axios.get('https://api.api-ninjas.com/v1/animals', {
      params: { name: species_name },
      headers: { 'X-Api-Key': process.env.API_NINJAS_KEY }
    });
    if (!speciesRes.data || speciesRes.data.length === 0) {
        return res.status(400).json({ message: `Species '${species_name}' not found. Please select a valid species.` });
    }
  } catch (err) {
      console.error("Species validation error:", err.message);
      return res.status(500).json({ message: 'Error validating species.' });
  }

  // Upload Photo
  let photoUrl = null;
  if (req.file) {
      photoUrl = await uploadToImgBB(req.file.buffer);
      if (!photoUrl) {
           return res.status(500).json({ message: 'Error uploading photo.' });
      }
  }

  try {
    const newSighting = await pool.query(
      `INSERT INTO sightings (user_id, species_name, latitude, longitude, sighting_notes, sighting_date, photo_url, region)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.userId, species_name, latitude, longitude, sighting_notes || '', sighting_date || new Date(), photoUrl, region]
    );
    res.status(201).json(newSighting.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error saving sighting.' });
  }
});

// 5. Get Sightings (Geospatial)
app.get('/api/sightings', async (req, res) => {
    const { lat, lon, radius, region } = req.query; // Radius in km

    try {
        let query = 'SELECT * FROM sightings';
        let params = [];
        let whereClauses = [];
        let paramIndex = 1;

        if (lat && lon && radius) {
            // Haversine formula
            // 6371 is Earth's radius in km
             query = `
                SELECT *,
                   (6371 * acos(cos(radians($1)) * cos(radians(latitude)) * cos(radians(longitude) - radians($2)) + sin(radians($1)) * sin(radians(latitude)))) AS distance
                FROM sightings
            `;
            whereClauses.push(`(6371 * acos(cos(radians($1)) * cos(radians(latitude)) * cos(radians(longitude) - radians($2)) + sin(radians($1)) * sin(radians(latitude)))) < $3`);
            params.push(lat, lon, radius);
            paramIndex = 4;
        } else {
             // Basic select if no geo
             query = 'SELECT * FROM sightings';
        }

        if (region) {
            whereClauses.push(`region = $${paramIndex}`);
            params.push(region);
            paramIndex++;
        }

        if (whereClauses.length > 0) {
            query += ' WHERE ' + whereClauses.join(' AND ');
        }

        if (lat && lon && radius) {
             query += ' ORDER BY distance';
        } else {
             query += ' ORDER BY created_at DESC';
        }

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error fetching sightings.' });
    }
});

// 6. Get User Sightings
app.get('/api/sightings/user', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sightings WHERE user_id = $1 ORDER BY created_at DESC', [req.user.userId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error fetching user sightings.' });
    }
});

// 7. Delete Sighting
app.delete('/api/sightings/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM sightings WHERE sighting_id = $1 AND user_id = $2 RETURNING *', [id, req.user.userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Sighting not found or not authorized to delete.' });
        }
        res.json({ message: 'Sighting deleted successfully.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error deleting sighting.' });
    }
});

// 9. Edit Sighting
app.put('/api/sightings/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { species_name, sighting_notes, sighting_date } = req.body;

    // Basic validation
    if (!species_name) {
         return res.status(400).json({ message: 'Species name is required.' });
    }

    try {
        const result = await pool.query(
            'UPDATE sightings SET species_name = $1, sighting_notes = $2, sighting_date = $3 WHERE sighting_id = $4 AND user_id = $5 RETURNING *',
            [species_name, sighting_notes || '', sighting_date || new Date(), id, req.user.userId]
        );

        if (result.rows.length === 0) {
             return res.status(404).json({ message: 'Sighting not found or not authorized to edit.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error updating sighting.' });
    }
});

// 8. Update User Profile
app.put('/api/user/profile', authenticateToken, async (req, res) => {
    const { username, email, phone_number, region } = req.body;

    // Construct dynamic update query
    let fields = [];
    let values = [];
    let idx = 1;

    if (username) { fields.push(`username = $${idx++}`); values.push(username); }
    if (email) { fields.push(`email = $${idx++}`); values.push(email); }
    if (phone_number) { fields.push(`phone_number = $${idx++}`); values.push(phone_number); }
    if (region) { fields.push(`region = $${idx++}`); values.push(region); }

    if (fields.length === 0) {
        return res.status(400).json({ message: 'No fields provided for update.' });
    }

    values.push(req.user.userId);
    const query = `UPDATE users SET ${fields.join(', ')} WHERE user_id = $${idx} RETURNING user_id, username, email, phone_number, region`;

    try {
        const result = await pool.query(query, values);
         if (result.rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        res.json({ message: 'Profile updated successfully', user: result.rows[0] });
    } catch (err) {
        console.error(err.message);
        if (err.code === '23505') {
            return res.status(400).json({ message: 'Email or Username already exists' });
        }
        res.status(500).json({ message: 'Server error updating profile.' });
    }
});

// 10. Get User Preferences
app.get('/api/preferences', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM user_preferences WHERE user_id = $1 ORDER BY created_at DESC', [req.user.userId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error fetching preferences.' });
    }
});

// 11. Add User Preference
app.post('/api/preferences', authenticateToken, async (req, res) => {
    const { type, value } = req.body;

    // Strict type validation per user requirement
    if (type !== 'species' && type !== 'location') {
         return res.status(400).json({ message: 'Invalid preference type. Must be "species" or "location".' });
    }
    if (!value) {
         return res.status(400).json({ message: 'Value is required.' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO user_preferences (user_id, type, value) VALUES ($1, $2, $3) RETURNING *',
            [req.user.userId, type, value]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        // Unique constraint violation
        if (err.code === '23505') {
            return res.status(400).json({ message: 'Preference already exists.' });
        }
        console.error(err.message);
        res.status(500).json({ message: 'Server error saving preference.' });
    }
});

// 12. Delete User Preference
app.delete('/api/preferences/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'DELETE FROM user_preferences WHERE preference_id = $1 AND user_id = $2 RETURNING *',
            [id, req.user.userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Preference not found or not authorized to delete.' });
        }
        res.json({ message: 'Preference deleted successfully.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error deleting preference.' });
    }
});

// 13. Submit User Species Entry
app.post('/api/species_entries', authenticateToken, async (req, res) => {
    const { species_name, description, habitat, fun_facts } = req.body;

    if (!species_name) {
        return res.status(400).json({ message: 'Species name is required.' });
    }

    try {
        // 1. Check Official API first
        const apiRes = await axios.get('https://api.api-ninjas.com/v1/animals', {
            params: { name: species_name },
            headers: { 'X-Api-Key': process.env.API_NINJAS_KEY }
        });

        // Exact match check to prevent entries if official data exists
        // API Ninjas fuzzy matches, so we need to be careful.
        // If API returns data, iterate and check for case-insensitive exact match
        if (apiRes.data && apiRes.data.length > 0) {
             const exactMatch = apiRes.data.find(animal => animal.name.toLowerCase() === species_name.toLowerCase());
             if (exactMatch) {
                 return res.status(400).json({ message: 'Official data for this species already exists. You cannot create a duplicate entry.' });
             }
        }

        // 2. Insert into DB (Unique constraint handles duplicate user entries)
        const result = await pool.query(
            'INSERT INTO species_entries (user_id, species_name, description, habitat, fun_facts) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [req.user.userId, species_name, description, habitat, fun_facts]
        );

        res.status(201).json(result.rows[0]);

    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ message: 'A user entry for this species already exists.' });
        }
        console.error(err.message);
        res.status(500).json({ message: 'Server error saving species entry.' });
    }
});

// 14. Hybrid Species Search
app.get('/api/species_search', async (req, res) => {
    const { query, region } = req.query;
    if (!query) {
        return res.status(400).json({ message: 'Query parameter is required.' });
    }

    try {
        // 1. Fetch from Official API
        const apiPromise = axios.get('https://api.api-ninjas.com/v1/animals', {
            params: { name: query },
            headers: { 'X-Api-Key': process.env.API_NINJAS_KEY }
        });

        // 2. Fetch from DB
        // Use ILIKE for case-insensitive partial match
        const dbPromise = pool.query(
            'SELECT * FROM species_entries WHERE species_name ILIKE $1',
            [`%${query}%`]
        );

        const [apiRes, dbRes] = await Promise.all([apiPromise, dbPromise]);

        let results = [];

        // Process API Results
        if (apiRes.data && Array.isArray(apiRes.data)) {
            let apiResults = apiRes.data;
            if (region) {
                 const targetRegion = region.replace(' ', '-');
                 apiResults = apiResults.filter(animal => {
                    if (!animal.locations || !Array.isArray(animal.locations)) return false;
                    return animal.locations.includes(targetRegion) || animal.locations.includes(region);
                });
            }
            results = apiResults.map(item => ({
                source: 'official',
                name: item.name,
                taxonomy: item.taxonomy,
                locations: item.locations,
                characteristics: item.characteristics
            }));
        }

        // Process DB Results
        // Note: DB entries don't have a 'region' field, so we return them regardless of region filter
        // unless we want to assume they are global or add a region field to them too.
        // Requirement didn't explicitly ask for region on user entries, but said "Hybrid Search... filtered by Region (API)".
        // It's safer to include them so users see their contributions.
        if (dbRes.rows.length > 0) {
            const dbResults = dbRes.rows.map(item => ({
                source: 'user',
                name: item.species_name,
                description: item.description,
                habitat: item.habitat,
                fun_facts: item.fun_facts,
                user_id: item.user_id // Maybe fetch username if needed?
            }));
            results = results.concat(dbResults);
        }

        res.json(results);

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error during hybrid search.' });
    }
});

// 15. Location Info Lookup (Wikipedia)
app.get('/api/location_info', async (req, res) => {
    const { query } = req.query;
    if (!query) {
         return res.status(400).json({ message: 'Query parameter is required.' });
    }

    try {
        // 1. Keyword Augmentation (Smart Search)
        // If query doesn't already contain specific keywords, try suggesting a better query
        let searchTerm = query;
        // Simple heuristic: if it looks like a generic name, prefer "National Park"
        // But we rely on OpenSearch to disambiguate.

        // 2. OpenSearch for Disambiguation/Discovery
        const openSearchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(searchTerm)}&limit=5&namespace=0&format=json`;
        const openRes = await axios.get(openSearchUrl);
        // Response format: [query, [titles], [descriptions], [urls]]

        const titles = openRes.data[1];
        const urls = openRes.data[3];

        if (!titles || titles.length === 0) {
            // Try appending "National Park" if not present
             if (!searchTerm.toLowerCase().includes('park') && !searchTerm.toLowerCase().includes('reserve')) {
                 const retryTerm = searchTerm + ' National Park';
                 const retryRes = await axios.get(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(retryTerm)}&limit=5&namespace=0&format=json`);
                 if (retryRes.data[1] && retryRes.data[1].length > 0) {
                     // Found results with appended keyword
                     // Return these as suggestions
                     return res.json({
                         type: 'disambiguation',
                         options: retryRes.data[1].map((t, i) => ({ title: t, url: retryRes.data[3][i] }))
                     });
                 }
             }
             return res.status(404).json({ message: 'Location not found.' });
        }

        // If we have an exact match or close match
        const bestMatchTitle = titles[0];

        // If there are multiple similar results and the query wasn't specific, maybe return disambiguation?
        // But for simplicity, if titles[0] is a good match, we use it.
        // If the user typed "Yellowstone" and we got "Yellowstone National Park" as #1, use it.
        // If we got "Yellowstone (TV Series)", we might have a problem.
        // Let's check for keywords in the results.

        // Filter titles for nature-related keywords to pick the best one?
        const natureKeywords = ['National Park', 'Reserve', 'Wildlife', 'Forest', 'Sanctuary', 'Zoo', 'Safari'];
        const natureMatch = titles.find(t => natureKeywords.some(k => t.includes(k)));

        const targetTitle = natureMatch || bestMatchTitle;

        // However, if we found multiple results and the user query was ambiguous, send options.
        if (titles.length > 1 && !natureMatch && titles[0].toLowerCase() !== query.toLowerCase()) {
             return res.json({
                 type: 'disambiguation',
                 options: titles.map((t, i) => ({ title: t, url: urls[i] }))
             });
        }

        // 3. Fetch Summary for the target title
        const summaryRes = await axios.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(targetTitle)}`);

         if (summaryRes.data) {
             res.json({
                 type: 'summary',
                 title: summaryRes.data.title,
                 extract: summaryRes.data.extract,
                 thumbnail: summaryRes.data.thumbnail ? summaryRes.data.thumbnail.source : null,
                 page_url: summaryRes.data.content_urls ? summaryRes.data.content_urls.desktop.page : null
             });
        } else {
            res.status(404).json({ message: 'Details not found.' });
        }

    } catch (err) {
        console.error('Wikipedia API error:', err.message);
        res.status(404).json({ message: 'Location not found or error fetching data.' });
    }
});

// --- Start Server ---
// Initialize DB then start listening
initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Backend server listening on port ${port}`);
  });
});
