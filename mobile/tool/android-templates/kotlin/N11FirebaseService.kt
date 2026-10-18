package vn.eleven.n11

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives the provider's token rotations and messages (push build only). A rotated token is handed to Dart (which binds it to the signed-in session; if the
 * app is not running the next `state` call reads the current token). A message that arrives while the app is closed or in the background is displayed by the
 * system from its notification part; while the app is open the live sync already updates the screen, so nothing is drawn twice. The message content is never logged.
 */
class N11FirebaseService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        N11PushChannel.sink?.invoke("token", token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Nothing to do: display (background) is the system's, live updates (foreground) come from the inbox sync.
    }
}
