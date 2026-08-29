package com.angkorsmp.angkorstore.config;

/** One rung of the configured rank ladder. `group` is the LuckPerms group this rung adds/removes. */
public record RankInfo(String id, String group, String displayName, int weight, double priceUsd) {
}
