plugins { id("com.android.library"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "vn.eleven.m14.map"
    compileSdk = 35
    buildToolsVersion = "35.0.0"
    defaultConfig { minSdk = 26 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    api("org.maplibre.gl:android-sdk:11.8.0")

}
