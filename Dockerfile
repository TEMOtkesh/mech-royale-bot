# zoro: a static Go binary in an empty image.
# Matches run it with no network, a read-only root, 1 CPU, 512 MB, uid 65534 and the map at /arena.
# The toolchain image is pinned by digest so rebuilds are reproducible.
FROM golang:1.25.4-alpine3.22@sha256:d3f0cf7723f3429e3f9ed846243970b20a2de7bae6a5b66fc5914e228d831bbb AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOTOOLCHAIN=local
RUN go build -trimpath -ldflags="-s -w" -o /out/zoro ./cmd/zoro

FROM scratch
COPY --from=build /out/zoro /zoro
USER 65534:65534
ENTRYPOINT ["/zoro"]
