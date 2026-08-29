package com.angkorsmp.angkorstore.store;

import java.util.List;

/** A paid delivery that couldn't be run because the player was offline; runs on their next join. */
public record PendingDelivery(String transactionId, String uuid, String name, String itemId, String itemName, List<String> commands) {
}
