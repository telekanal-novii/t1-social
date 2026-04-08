FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Создаём директории для загруженных файлов
RUN mkdir -p public/avatars public/media

ENV PORT=7860

EXPOSE 7860

CMD ["node", "server.js"]
