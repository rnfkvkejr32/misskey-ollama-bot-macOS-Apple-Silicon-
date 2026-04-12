FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY bot.js ./
COPY workflows ./workflows

RUN mkdir -p /app/quarantine /app/workflows

CMD ["node", "bot.js"]
