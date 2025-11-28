const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

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

    console.log('Database migrations completed successfully.');

  } catch (err) {
    console.error('Migration failed:', err);
    // We don't exit process, but requests might fail if DB is bad.
  } finally {
    client.release();
  }
}

// --- API Endpoints ---

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

// --- Start Server ---
// Initialize DB then start listening
initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Backend server listening on port ${port}`);
  });
});
