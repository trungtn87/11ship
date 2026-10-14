package vn.eleven.gateway

/** The result of one job, as it must reach the server. Identifiers only: never the recipient, never the text, never the code. */
class PendingReport(val jobId: String, val attemptId: String, val result: String, val errorCode: String?)

/** Durable single slot for the report that has not reached the server yet. */
interface PendingStore {
    fun pending(): PendingReport?
    fun save(report: PendingReport)
    fun clear()
}

/** The server answered /ack with an HTTP status. Only [isTerminalAckStatus] statuses end the report; anything else is kept and retried. */
class AckHttpError(val status: Int) : Exception("ack http $status")

/**
 * The only statuses that PROVE the server holds a final answer for this attempt, from the API contract: 404 GATEWAY_JOB_NOT_FOUND
 * (unknown job/attempt/device) and 409 GATEWAY_ACK_CONFLICT (a different final result already recorded). 408/429 (throttling),
 * 403 (a proxy/WAF may answer it for a while), 400, 401 and every 5xx or I/O error are NOT terminal: the report is kept and retried.
 */
fun isTerminalAckStatus(status: Int): Boolean = status == 404 || status == 409

/**
 * Keeps the "report before anything else" rule of the gateway in ONE place that has no Android dependency (so it is unit tested):
 *  - a result is stored durably BEFORE the server is told;
 *  - there is exactly one slot, so a second result may never be recorded while the first one is unreported ([record] refuses);
 *  - the gateway may take new work ONLY when the slot is empty ([mayClaim]): a /ack that keeps failing while /heartbeat and /claim
 *    work must not let the old result be overwritten and lost (the server would turn the job UNKNOWN although the SMS was sent).
 */
class ReportFlusher(
    private val store: PendingStore,
    private val ack: (PendingReport) -> Unit,
    /** Waits the given seconds; false when the wait was interrupted (the service is stopping). */
    private val sleep: (Int) -> Boolean,
) {
    /** Stores the result of the job being finished. Never replaces a report that has not been delivered. */
    fun record(report: PendingReport) {
        val existing = store.pending()
        check(existing == null || (existing.jobId == report.jobId && existing.attemptId == report.attemptId)) {
            "an earlier result is still unreported"
        }
        store.save(report)
    }

    /** Why the last flush left the report pending, as a short code for the status line ("ACK_HTTP_429", "ACK_PENDING"); null if delivered. */
    var lastFailureCode: String? = null
        private set

    /** Tries to deliver the stored report (a few attempts, backing off). True when nothing is pending afterwards. */
    fun flush(): Boolean {
        val report = store.pending() ?: return true
        var wait = 2
        for (attempt in 1..4) {
            try {
                ack(report)
                store.clear()
                lastFailureCode = null
                return true
            } catch (e: AckHttpError) {
                if (isTerminalAckStatus(e.status)) {
                    store.clear()
                    lastFailureCode = null
                    return true
                }
                lastFailureCode = "ACK_HTTP_${e.status}"
            } catch (e: Exception) {
                lastFailureCode = "ACK_PENDING"
            }
            if (attempt == 4 || !sleep(wait)) return false
            wait *= 2
        }
        return false
    }

    /** True only when no result is waiting for the server: the one condition under which a new job may be claimed. */
    fun mayClaim(): Boolean = flush()
}
