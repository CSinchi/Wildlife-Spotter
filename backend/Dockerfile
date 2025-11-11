FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of backend app source code
COPY . .

EXPOSE 3000
CMD [ "node", "server.js" ]