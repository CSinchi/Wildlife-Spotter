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
async function initializeDatabase() {
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
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_sighting_user FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
    `);

    // Ensure index on sightings location
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sighting_location ON sightings(latitude, longitude);`);

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
  const name = req.query.name;
  if (!name) {
    return res.status(400).json({ message: 'Name parameter is required' });
  }

  try {
    const response = await axios.get('https://api.api-ninjas.com/v1/animals', {
      params: { name: name },
      headers: { 'X-Api-Key': process.env.API_NINJAS_KEY }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching species:', error.message);
    res.status(500).json({ message: 'Error fetching species data' });
  }
});

// 1. Register a new user
app.post('/register', async (req, res) => {
  const { username, phone_number, email, password } = req.body;

  if (!email || !password || !username) {
    return res.status(400).json({ message: 'Email, Username, and password are required' });
  }

  try {
    // Hash the password before storing it
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await pool.query(
      'INSERT INTO users (username, email, phone_number, password_hash) VALUES ($1, $2, $3, $4) RETURNING *',
      [username, email, phone_number, passwordHash]
    );

    res.status(201).json({
      message: 'User created successfully',
      user: {
        user_id: newUser.rows[0].user_id,
        username: newUser.rows[0].username,
        email: newUser.rows[0].email,
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

    res.json({ message: 'Login successful', token: token });

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
  const { species_name, latitude, longitude, sighting_notes, sighting_date } = req.body;

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
      `INSERT INTO sightings (user_id, species_name, latitude, longitude, sighting_notes, sighting_date, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.userId, species_name, latitude, longitude, sighting_notes || '', sighting_date || new Date(), photoUrl]
    );
    res.status(201).json(newSighting.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error saving sighting.' });
  }
});

// 5. Get Sightings (Geospatial)
app.get('/api/sightings', async (req, res) => {
    const { lat, lon, radius } = req.query; // Radius in km

    try {
        let query = 'SELECT * FROM sightings';
        let params = [];

        if (lat && lon && radius) {
            // Haversine formula
            // 6371 is Earth's radius in km
            query = `
                SELECT *,
                   (6371 * acos(cos(radians($1)) * cos(radians(latitude)) * cos(radians(longitude) - radians($2)) + sin(radians($1)) * sin(radians(latitude)))) AS distance
                FROM sightings
                WHERE (6371 * acos(cos(radians($1)) * cos(radians(latitude)) * cos(radians(longitude) - radians($2)) + sin(radians($1)) * sin(radians(latitude)))) < $3
                ORDER BY distance
            `;
            params = [lat, lon, radius];
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

// 8. Update User Profile
app.put('/api/user/profile', authenticateToken, async (req, res) => {
    const { username, email, phone_number } = req.body;

    // Construct dynamic update query
    let fields = [];
    let values = [];
    let idx = 1;

    if (username) { fields.push(`username = $${idx++}`); values.push(username); }
    if (email) { fields.push(`email = $${idx++}`); values.push(email); }
    if (phone_number) { fields.push(`phone_number = $${idx++}`); values.push(phone_number); }

    if (fields.length === 0) {
        return res.status(400).json({ message: 'No fields provided for update.' });
    }

    values.push(req.user.userId);
    const query = `UPDATE users SET ${fields.join(', ')} WHERE user_id = $${idx} RETURNING user_id, username, email, phone_number`;

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

// --- Start Server ---
// Initialize DB then start listening
initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Backend server listening on port ${port}`);
  });
});
