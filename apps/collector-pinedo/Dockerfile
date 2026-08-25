FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build
COPY src/tags.pinedo.json ./dist/tags.pinedo.json

CMD ["node", "dist/index.js"]
