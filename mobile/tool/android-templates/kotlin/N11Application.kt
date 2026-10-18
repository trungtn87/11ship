package vn.eleven.n11

import android.app.Application

/** Initialises the push provider before any component runs, so a message that wakes a dead process finds it ready (a no-op on a build without push). */
class N11Application : Application() {
    override fun onCreate() {
        super.onCreate()
        N11PushChannel.ensureFirebase(this)
        N11PushChannel.createChannels(this)
    }
}
