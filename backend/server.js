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
      'INSERT INTO users (username, email, phone_number, password_hash) VALUES ($1, $2) RETURNING *',
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
app.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});