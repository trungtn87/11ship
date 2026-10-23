package vn.eleven.m14.flutter.map

import io.flutter.embedding.engine.plugins.FlutterPlugin

/** Registers only the offline map view. No channel, no permission, no service: a position is never read here. */
class M14MapPlugin: FlutterPlugin {
    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        binding.platformViewRegistry.registerViewFactory("vn.eleven/m14/map", M14MapFactory(binding.binaryMessenger))
    }
    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {}
}
