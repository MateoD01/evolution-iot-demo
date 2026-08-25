FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build
# tsc no copia archivos no-.ts al outDir: el diccionario de tags viaja aparte
COPY src/tags.pinedo.json ./dist/tags.pinedo.json

EXPOSE 502

CMD ["node", "dist/index.js"]
