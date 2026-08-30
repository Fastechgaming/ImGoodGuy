package com.angkorsmp.angkorstore.http;

import com.angkorsmp.angkorstore.api.AngkorStoreApi;
import com.angkorsmp.angkorstore.config.PluginConfig;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;

/**
 * The whole HTTP surface, on its own thread pool - never the server's main
 * thread. See util.MainThread for the one door back onto it.
 *
 * Auth is a single shared secret in a header (X-AngkorStore-Secret),
 * compared in constant time - deliberately simpler than the previous
 * key+HMAC-signature scheme, per the server owner's request for something
 * easier to configure and debug. If this box is reachable over the open
 * internet rather than localhost/a private network, put it behind a
 * tunnel/VPN so the secret isn't sent in the clear (see config.yml).
 */
public final class ApiServer {

    private final JavaPlugin plugin;
    private final PluginConfig config;
    private final AngkorStoreApi api;
    private final Logger log;
    private final Gson gson = new Gson();

    private HttpServer server;
    private ExecutorService executor;
    private final AtomicInteger threadCount = new AtomicInteger();

    public ApiServer(JavaPlugin plugin, PluginConfig config, AngkorStoreApi api) {
        this.plugin = plugin;
        this.config = config;
        this.api = api;
        this.log = plugin.getLogger();
    }

    public void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress(config.bind, config.port), 0);
        executor = Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "AngkorStore-http-" + threadCount.incrementAndGet());
            t.setDaemon(true);
            return t;
        });
        server.setExecutor(executor);

        server.createContext("/api/v1/health", ex -> handle(ex, false, (e, body) -> api.health()));
        server.createContext("/api/v1/server", ex -> handle(ex, true, (e, body) -> await(api.server())));
        server.createContext("/api/v1/ranks", ex -> handle(ex, true, (e, body) -> api.ranks()));
        server.createContext("/api/v1/bans", ex -> handle(ex, true, (e, body) -> await(api.bans())));
        server.createContext("/api/v1/player/verify", ex -> handle(ex, true, (e, body) -> await(api.verifyPlayer(body))));
        server.createContext("/api/v1/coins/grant", ex -> handle(ex, true, (e, body) -> await(api.grantCoins(body))));
        server.createContext("/api/v1/purchase/deliver", ex -> handle(ex, true, (e, body) -> await(api.deliverPurchase(body))));
        server.createContext("/api/v1/rank/upgrade", ex -> handle(ex, true, (e, body) -> await(api.upgradeRank(body))));
        // GET /api/v1/player/{uuid}/profile - registered on the parent path, split by hand below.
        server.createContext("/api/v1/player/", ex -> handle(ex, true, (e, body) -> {
            String path = e.getRequestURI().getPath();
            String rest = path.substring("/api/v1/player/".length());
            if (rest.endsWith("/profile")) {
                String uuid = rest.substring(0, rest.length() - "/profile".length());
                return await(api.profile(uuid));
            }
            throw new ApiException(404, "NOT_FOUND", "No such route.");
        }));

        server.start();
        log.info("[AngkorStore] API listening on " + config.bind + ":" + config.port);
    }

    public void stop() {
        if (server != null) server.stop(1);
        if (executor != null) executor.shutdownNow();
    }

    private interface Handler {
        JsonObject handle(HttpExchange exchange, JsonObject body) throws Exception;
    }

    private void handle(HttpExchange exchange, boolean requiresAuth, Handler handler) {
        try {
            if (requiresAuth) {
                ApiException authError = checkAuth(exchange);
                if (authError != null) {
                    writeError(exchange, authError);
                    return;
                }
            }
            JsonObject body = readBody(exchange);
            JsonObject result = handler.handle(exchange, body);
            writeJson(exchange, 200, result);
        } catch (ApiException e) {
            writeError(exchange, e);
        } catch (CompletionException e) {
            if (e.getCause() instanceof ApiException apiEx) writeError(exchange, apiEx);
            else {
                log.warning("[AngkorStore] Unhandled error: " + e.getCause());
                writeError(exchange, new ApiException(500, "INTERNAL", "Internal error."));
            }
        } catch (TimeoutException e) {
            writeError(exchange, new ApiException(504, "TIMEOUT", "The server took too long to respond."));
        } catch (Exception e) {
            log.warning("[AngkorStore] Unhandled error: " + e);
            writeError(exchange, new ApiException(500, "INTERNAL", "Internal error."));
        } finally {
            exchange.close();
        }
    }

    private static JsonObject await(CompletableFuture<JsonObject> future) throws Exception {
        try {
            return future.get(5, TimeUnit.SECONDS);
        } catch (java.util.concurrent.ExecutionException e) {
            if (e.getCause() instanceof ApiException apiEx) throw apiEx;
            if (e.getCause() instanceof RuntimeException re) throw re;
            throw e;
        }
    }

    private ApiException checkAuth(HttpExchange exchange) {
        if (!config.allowedIps.isEmpty()) {
            String remote = exchange.getRemoteAddress().getAddress().getHostAddress();
            if (!config.allowedIps.contains(remote)) {
                return new ApiException(403, "IP_NOT_ALLOWED", "This address is not on the allow list.");
            }
        }
        String provided = exchange.getRequestHeaders().getFirst("X-AngkorStore-Secret");
        if (provided == null || !constantTimeEquals(provided, config.secret)) {
            return new ApiException(401, "BAD_SECRET", "Missing or wrong X-AngkorStore-Secret header.");
        }
        return null;
    }

    private static boolean constantTimeEquals(String a, String b) {
        byte[] ab = a.getBytes(StandardCharsets.UTF_8);
        byte[] bb = b.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(ab, bb);
    }

    private JsonObject readBody(HttpExchange exchange) throws IOException {
        try (InputStream in = exchange.getRequestBody()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            in.transferTo(out);
            String raw = out.toString(StandardCharsets.UTF_8);
            if (raw.isBlank()) return new JsonObject();
            try {
                return gson.fromJson(raw, JsonObject.class);
            } catch (JsonParseException e) {
                throw new ApiException(400, "BAD_JSON", "Request body is not valid JSON.");
            }
        }
    }

    private void writeJson(HttpExchange exchange, int status, JsonObject json) throws IOException {
        byte[] bytes = gson.toJson(json).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    private void writeError(HttpExchange exchange, ApiException e) {
        JsonObject json = new JsonObject();
        json.addProperty("ok", false);
        json.addProperty("error", e.getMessage());
        json.addProperty("code", e.code);
        if (e.extra != null) for (var entry : e.extra.entrySet()) json.add(entry.getKey(), entry.getValue());
        try {
            writeJson(exchange, e.status, json);
        } catch (IOException io) {
            log.warning("[AngkorStore] Could not write error response: " + io.getMessage());
        }
    }
}
