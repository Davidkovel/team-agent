# Build e serviço do site estático da Blue Magnitude.
# O next.config.ts vive no repo e NÃO é injetado aqui: o build local tem de ser
# igual ao que vai para o ar.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/out /srv
EXPOSE 80
