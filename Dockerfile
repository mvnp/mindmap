FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN MINDMAP_DB=:memory: npm run build
RUN mkdir -p /data
ENV MINDMAP_DB=/data/mindmap.db
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
