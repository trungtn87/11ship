plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "vn.eleven.gpstest"
    compileSdk = 35
    buildFeatures { buildConfig = true }
    defaultConfig { minSdk = 26; targetSdk = 35; applicationId = "vn.eleven.ship.gpstest"; versionCode = (System.getenv("GPS_VERSION_CODE") ?: "1").toInt(); versionName = "0.1.0"; buildConfigField("String", "ROUTING_URL", "\"${System.getenv("GPS_ROUTING_URL") ?: ""}\"") }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation(project(":map"))
    implementation(project(":gps"))
    implementation(project(":history"))
    implementation(project(":routing"))
}
