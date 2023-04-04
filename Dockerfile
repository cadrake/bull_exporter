FROM node:18-bullseye-slim as build-env
ENV NODE_ENV=production

RUN mkdir -p /build
WORKDIR /build

COPY package.json .
COPY yarn.lock .
RUN npm install tsc
RUN yarn add typescript tsc ts-node && yarn install --frozen-lockfile --prefer-offline && yarn cache clean

COPY . .
RUN node_modules/.bin/tsc -p .

FROM gcr.io/distroless/nodejs:18

COPY --from=build-env /build/node_modules /app/node_modules
COPY --from=build-env /build/dist /app/dist

CMD ["/app/dist/src/index.js"]
