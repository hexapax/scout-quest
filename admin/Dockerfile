FROM node:20-slim
WORKDIR /app
COPY dist/ dist/
COPY node_modules/ node_modules/
COPY package.json .
ENV NODE_ENV=production
EXPOSE 3082
CMD ["node", "dist/index.js"]
