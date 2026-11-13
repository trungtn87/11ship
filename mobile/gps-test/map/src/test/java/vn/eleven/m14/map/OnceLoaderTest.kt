package vn.eleven.m14.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** The 8 MB map package must be read once per process, retried after a failure and never started twice by views created/disposed together (#299, #323). */
class OnceLoaderTest {
    @Test fun loadsOnceAndReusesTheResult() {
        val loader = OnceLoader<List<String>>()
        val calls = AtomicInteger()
        val a = loader.get { calls.incrementAndGet(); listOf("x") }
        val b = loader.get { calls.incrementAndGet(); listOf("y") }
        assertSame(a, b)
        assertEquals(1, calls.get())
        assertTrue(loader.isLoaded())
    }

    @Test fun aFailedLoadCachesNothingAndTheNextCallRetries() {
        val loader = OnceLoader<String>()
        val calls = AtomicInteger()
        try {
            loader.get { calls.incrementAndGet(); error("corrupt package") }
            fail("must throw")
        } catch (e: IllegalStateException) {
            assertEquals("corrupt package", e.message)
        }
        assertFalse(loader.isLoaded())
        assertEquals("ok", loader.get { calls.incrementAndGet(); "ok" })
        assertEquals(2, calls.get())
        assertTrue(loader.isLoaded())
    }

    @Test fun manyViewsLoadingAtTheSameTimeRunTheLoaderOnce() {
        val loader = OnceLoader<String>()
        val calls = AtomicInteger()
        val n = 16
        val pool = Executors.newFixedThreadPool(n)
        val start = CountDownLatch(1)
        val done = CountDownLatch(n)
        val results = java.util.Collections.synchronizedList(mutableListOf<String>())
        try {
            repeat(n) {
                pool.execute {
                    start.await()
                    results.add(loader.get { calls.incrementAndGet(); Thread.sleep(50); "pkg" })
                    done.countDown()
                }
            }
            start.countDown()
            assertTrue("all callers finish", done.await(10, TimeUnit.SECONDS))
        } finally {
            pool.shutdownNow()
        }
        assertEquals(1, calls.get())
        assertEquals(n, results.size)
        assertTrue(results.all { it == "pkg" })
    }

    @Test fun concurrentCallersAfterAFailureRetryOneAtATimeAndEndWithTheGoodResult() {
        val loader = OnceLoader<String>()
        val calls = AtomicInteger()
        val running = AtomicInteger()
        val maxRunning = AtomicInteger()
        val n = 12
        val pool = Executors.newFixedThreadPool(n)
        val start = CountDownLatch(1)
        val done = CountDownLatch(n)
        val ok = AtomicInteger()
        val failed = AtomicInteger()
        try {
            repeat(n) {
                pool.execute {
                    start.await()
                    try {
                        loader.get {
                            val now = running.incrementAndGet()
                            maxRunning.updateAndGet { m -> maxOf(m, now) }
                            try {
                                Thread.sleep(10)
                                if (calls.incrementAndGet() == 1) error("first attempt fails")
                                "pkg"
                            } finally {
                                running.decrementAndGet()
                            }
                        }
                        ok.incrementAndGet()
                    } catch (e: IllegalStateException) {
                        failed.incrementAndGet()
                    }
                    done.countDown()
                }
            }
            start.countDown()
            assertTrue(done.await(10, TimeUnit.SECONDS))
        } finally {
            pool.shutdownNow()
        }
        assertEquals("only the caller that ran the failing load sees the failure", 1, failed.get())
        assertEquals(n - 1, ok.get())
        assertEquals("loads never overlap", 1, maxRunning.get())
        assertEquals("one failure then one success", 2, calls.get())
        assertEquals("pkg", loader.get { error("must be cached") })
    }

    /** A view disposed while the package is still loading just stops using the result; the load finishes once and the next view gets the cached value. */
    @Test fun aViewDisposedMidLoadDoesNotLoseOrRestartTheLoad() {
        val loader = OnceLoader<String>()
        val calls = AtomicInteger()
        val inLoad = CountDownLatch(1)
        val release = CountDownLatch(1)
        val pool = Executors.newSingleThreadExecutor()
        try {
            val first = pool.submit<String> {
                loader.get { calls.incrementAndGet(); inLoad.countDown(); release.await(10, TimeUnit.SECONDS); "pkg" }
            }
            assertTrue(inLoad.await(10, TimeUnit.SECONDS))
            // The first view is disposed here: nothing will use its result, and nothing cancels the shared load.
            release.countDown()
            assertEquals("pkg", first.get(10, TimeUnit.SECONDS))
            assertEquals("pkg", loader.get { calls.incrementAndGet(); "again" })
            assertEquals(1, calls.get())
        } finally {
            pool.shutdownNow()
        }
    }
}
