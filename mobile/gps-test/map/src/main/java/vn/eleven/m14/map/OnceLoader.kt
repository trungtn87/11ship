package vn.eleven.m14.map

/**
 * Process-wide "load once" cache for the 8 MB map package (#299). Concurrent callers wait for the one running load instead of starting another;
 * a load that throws caches nothing, so the next caller retries. It holds the result only, never a Context.
 */
class OnceLoader<T : Any> {
    private val lock = Any()
    private var value: T? = null

    fun get(load: () -> T): T = synchronized(lock) { value ?: load().also { value = it } }

    /** For tests. */
    fun isLoaded(): Boolean = synchronized(lock) { value != null }
}
