-- Create the users table
CREATE TABLE IF NOT EXISTS users (
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone_number VARCHAR(50) NULL, -- Added phone number, allowing it to be optional
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create the login_tokens table
CREATE TABLE IF NOT EXISTS login_tokens (
    token_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    token TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Set up a foreign key relationship
    CONSTRAINT fk_user
        FOREIGN KEY(user_id) 
        REFERENCES users(user_id)
        ON DELETE CASCADE -- If a user is deleted, remove their tokens
);

-- Add an index for faster token lookups
CREATE INDEX IF NOT EXISTS idx_token ON login_tokens(token);