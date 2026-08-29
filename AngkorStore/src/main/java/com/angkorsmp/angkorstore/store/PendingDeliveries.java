package com.angkorsmp.angkorstore.store;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;

import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.logging.Logger;

/**
 * Deliveries a player was offline for, persisted so they survive a server
 * restart (per the plugin's own acceptance test) and run on the player's
 * next join.
 */
public final class PendingDeliveries {

    private static final Type LIST_TYPE = new TypeToken<List<PendingDelivery>>() {
    }.getType();

    private final File file;
    private final Gson gson = new GsonBuilder().setPrettyPrinting().create();
    private final List<PendingDelivery> queue = new ArrayList<>();
    private final Object lock = new Object();
    private final Logger log;

    public PendingDeliveries(File dataFolder, Logger log) {
        this.file = new File(dataFolder, "pending.json");
        this.log = log;
        load();
    }

    private void load() {
        if (!file.exists()) return;
        try (FileReader reader = new FileReader(file)) {
            List<PendingDelivery> loaded = gson.fromJson(reader, LIST_TYPE);
            if (loaded != null) queue.addAll(loaded);
            if (!queue.isEmpty()) log.info("[AngkorStore] " + queue.size() + " purchase(s) still queued for delivery.");
        } catch (IOException e) {
            log.warning("[AngkorStore] Could not read pending.json: " + e.getMessage());
        }
    }

    public void add(PendingDelivery delivery) {
        synchronized (lock) {
            queue.add(delivery);
            save();
        }
    }

    public void remove(String transactionId) {
        synchronized (lock) {
            queue.removeIf(d -> d.transactionId().equals(transactionId));
            save();
        }
    }

    public int size() {
        synchronized (lock) {
            return queue.size();
        }
    }

    /** Deliveries waiting for this player, oldest first. Does not remove them - call remove() once each is actually run. */
    public List<PendingDelivery> forPlayer(UUID uuid) {
        synchronized (lock) {
            List<PendingDelivery> out = new ArrayList<>();
            String target = uuid.toString();
            for (PendingDelivery d : queue) if (d.uuid().equals(target)) out.add(d);
            return out;
        }
    }

    private void save() {
        File tmp = new File(file.getParentFile(), file.getName() + "." + System.nanoTime() + ".tmp");
        try {
            file.getParentFile().mkdirs();
            try (FileWriter writer = new FileWriter(tmp)) {
                gson.toJson(queue, LIST_TYPE, writer);
            }
            if (!tmp.renameTo(file)) {
                file.delete();
                tmp.renameTo(file);
            }
        } catch (IOException e) {
            log.warning("[AngkorStore] Could not persist pending.json: " + e.getMessage());
        }
    }
}
