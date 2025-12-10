FROM node:20-alpine

WORKDIR /app

# copy package files
COPY package*.json ./

# Install ALL dependencies (including dev)
RUN npm install --include=dev

# copy source code
COPY . .

# Build TypeScript (dist/)
RUN npm run build || true

CMD ["npm", "run", "dev"]
