FROM node:18-bullseye-slim as build-env

RUN mkdir -p /build
WORKDIR /build

COPY package.json .
COPY yarn.lock .
RUN yarn install --pure-lockfile

COPY . .
RUN node_modules/.bin/tsc -p .
RUN yarn install --pure-lockfile --production

FROM gcr.io/distroless/nodejs:18

COPY --from=build-env /build/node_modules /app/node_modules
COPY --from=build-env /build/dist /app/dist

CMD ["/app/dist/src/index.js"]
