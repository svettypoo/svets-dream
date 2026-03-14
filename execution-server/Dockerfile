FROM node:20-slim

# Install system packages: git, curl, bash, python3, unzip, audio (pulseaudio + ffmpeg)
RUN apt-get update && apt-get install -y \
    git curl bash python3 python3-pip unzip ca-certificates \
    pulseaudio pulseaudio-utils ffmpeg alsa-utils \
    xvfb espeak-ng \
    libgl1-mesa-dri libegl1-mesa libgbm1 \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

# PulseAudio config — allow daemonize in container, no sandbox
RUN mkdir -p /root/.config/pulse && printf 'default-sample-rate = 44100\ndaemon-binary = /usr/bin/pulseaudio\n' > /root/.config/pulse/client.conf

# Install global CLIs
RUN npm install -g vercel @railway/cli

WORKDIR /app
COPY package.json ./
RUN npm install --production

COPY . .

ENV PORT=3333
EXPOSE 3333

CMD ["/bin/bash", "-c", "node setup.js && node server.js"]
