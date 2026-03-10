FROM node:20-slim

# Install system packages: git, curl, bash, python3, unzip
RUN apt-get update && apt-get install -y \
    git curl bash python3 python3-pip unzip ca-certificates \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Install global CLIs
RUN npm install -g vercel @railway/cli

WORKDIR /app
COPY package.json ./
RUN npm install --production

COPY . .

ENV PORT=3333
EXPOSE 3333

CMD ["/bin/bash", "-c", "node setup.js && node server.js"]
