-- Create the users table
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone_number VARCHAR(50) NULL, -- Added phone number, allowing it to be optional
    region VARCHAR(50) DEFAULT 'North America',
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

-- Create the sightings table
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

    CONSTRAINT fk_sighting_user
        FOREIGN KEY(user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sighting_location ON sightings(latitude, longitude);

-- Create the user_preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    preference_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'species' or 'location'
    value VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_preference_user
        FOREIGN KEY(user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_user_preference
        UNIQUE(user_id, type, value)
);

-- Create the species_entries table
CREATE TABLE IF NOT EXISTS species_entries (
    entry_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    species_name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    habitat TEXT,
    fun_facts TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_entry_user
        FOREIGN KEY(user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
);