package com.angkorsmp.angkorstore.util;

import org.bukkit.plugin.java.JavaPlugin;

import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;

/**
 * The one and only door between an HTTP worker thread and the Bukkit API.
 *
 * HTTP requests are handled on their own thread pool (see http.ApiServer);
 * nothing on that pool may call Bukkit, Vault, or Floodgate directly. Every
 * such call goes through here instead, hops onto the main thread for the
 * smallest possible unit of work, and hands the HTTP thread a future to
 * wait on (with a timeout, at the call site) rather than blocking the
 * server itself.
 */
public final class MainThread {
    private MainThread() {
    }

    public static <T> CompletableFuture<T> supply(JavaPlugin plugin, Callable<T> work) {
        CompletableFuture<T> future = new CompletableFuture<>();
        plugin.getServer().getScheduler().runTask(plugin, () -> {
            try {
                future.complete(work.call());
            } catch (Throwable t) {
                future.completeExceptionally(t);
            }
        });
        return future;
    }

    public static CompletableFuture<Void> run(JavaPlugin plugin, Runnable work) {
        return supply(plugin, () -> {
            work.run();
            return null;
        });
    }
}
