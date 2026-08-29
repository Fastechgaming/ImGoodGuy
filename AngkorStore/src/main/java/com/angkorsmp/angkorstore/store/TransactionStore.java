package com.angkorsmp.angkorstore.store;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.reflect.TypeToken;

import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.lang.reflect.Type;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

/**
 * The single most important correctness requirement in this plugin: a
 * transactionId is only ever applied once. Every /coins/grant,
 * /purchase/deliver and /rank/upgrade call is persisted here keyed on its
 * transactionId, so a retried request - the website's own retry, a network
 * hiccup, a replayed call - returns the ORIGINAL result and touches the
 * player's balance/rank/inventory nothing at all the second time.
 *
 * Flat JSON file, matching the website's own "tiny JSON file database"
 * approach (lib/store.js) - this server's transaction volume never needs a
 * real database.
 */
public final class TransactionStore {

    private static final Type MAP_TYPE = new TypeToken<Map<String, JsonObject>>() {
    }.getType();

    private final File file;
    private final Gson gson = new GsonBuilder().setPrettyPrinting().create();
    private final Map<String, JsonObject> cache = new ConcurrentHashMap<>();
    private final Object writeLock = new Object();
    private final Logger log;

    public TransactionStore(File dataFolder, Logger log) {
        this.file = new File(dataFolder, "transactions.json");
        this.log = log;
        load();
    }

    private void load() {
        if (!file.exists()) return;
        try (FileReader reader = new FileReader(file)) {
            Map<String, JsonObject> loaded = gson.fromJson(reader, MAP_TYPE);
            if (loaded != null) cache.putAll(loaded);
            log.info("[AngkorStore] Loaded " + cache.size() + " past transactions.");
        } catch (IOException e) {
            log.warning("[AngkorStore] Could not read transactions.json: " + e.getMessage());
        }
    }

    public JsonObject get(String transactionId) {
        return cache.get(transactionId);
    }

    public boolean has(String transactionId) {
        return cache.containsKey(transactionId);
    }

    /** Records a result under this transactionId and flushes to disk. Call only once per id - check has() first. */
    public void put(String transactionId, JsonObject result) {
        cache.put(transactionId, result);
        synchronized (writeLock) {
            File tmp = new File(file.getParentFile(), file.getName() + "." + System.nanoTime() + ".tmp");
            try {
                file.getParentFile().mkdirs();
                try (FileWriter writer = new FileWriter(tmp)) {
                    gson.toJson(cache, MAP_TYPE, writer);
                }
                if (!tmp.renameTo(file)) {
                    // Windows can refuse an atomic rename onto an existing file; fall back to delete+rename.
                    file.delete();
                    tmp.renameTo(file);
                }
            } catch (IOException e) {
                log.warning("[AngkorStore] Could not persist transactions.json: " + e.getMessage());
            }
        }
    }
}
