package com.angkorsmp.angkorstore.http;

import com.google.gson.JsonObject;

/** Thrown anywhere in the API layer to produce {ok:false, error, code, ...extra} with the given HTTP status. */
public class ApiException extends RuntimeException {
    public final int status;
    public final String code;
    public final JsonObject extra; // merged into the error body, e.g. RANK_CHANGED's currentRank - null if none

    public ApiException(int status, String code, String message) {
        this(status, code, message, null);
    }

    public ApiException(int status, String code, String message, JsonObject extra) {
        super(message);
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
}
