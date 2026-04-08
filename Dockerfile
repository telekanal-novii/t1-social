FROM node:20-slim

WORKDIR /app

# Зависимости для sharp (обработка изображений) и ffmpeg (сжатие аудио)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --production && npm cache clean --force

# Force fresh copy (ADD invalidates cache more aggressively)
ADD . .

# Создаём директории для загруженных файлов
RUN mkdir -p public/avatars public/media

ENV PORT=7860

EXPOSE 7860

CMD ["node", "server.js"]
