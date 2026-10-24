package vn.eleven.n11

import android.app.Application
import vn.eleven.m14.flutter.ShipSessionLink

/**
 * 11Ship only. Initialises the push provider before any component runs (as N11Application), and hands the location service its way to the session: a
 * reader of the app's own encrypted token store. It runs in every process start, so a service that Android restarts without the app finds it ready.
 */
class N11Application : Application() {
    override fun onCreate() {
        super.onCreate()
        N11PushChannel.ensureFirebase(this)
        N11PushChannel.createChannels(this)
        val store = N11DeviceStore(this)
        ShipSessionLink.tokenReader = { store.readToken() }
    }
}
