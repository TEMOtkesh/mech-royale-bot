FROM oven/bun:1.4.4-slim
WORKDIR /bot
COPY . .
ENTRYPOINT ["bun", "/bot/main.ts"]
