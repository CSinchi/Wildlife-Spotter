module.exports = {
  apps : [{
    name   : "wildlife-api",
    script : "server.js",
    env: {
      NODE_ENV: "production",
      DB_HOST: "wildlife-db.c0xey8q0wsq7.us-east-1.rds.amazonaws.com",
      DB_USER: "myuser",
      DB_PASSWORD: "GaoOlmQqL68qvsLnPkzA",
      DB_NAME: "mydb",
      JWT_SECRET: "production_secret_key",
      API_NINJAS_KEY: "r5MbX8lQzNhJnhHuh+3S4A==9mmag4bQW8Zmesl1",
      IMGBB_KEY: "42f7b91c1bbf6326005d55c2873332d3"
    }
  }]
}