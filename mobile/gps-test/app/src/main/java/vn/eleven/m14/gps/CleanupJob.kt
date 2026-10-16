package vn.eleven.m14.gps

import android.app.job.*
import android.content.ComponentName
import android.content.Context
import vn.eleven.m14.history.HistoryStore

class CleanupJob: JobService() {
    override fun onStartJob(params: JobParameters): Boolean { HistoryStore(this).use { it.prune() }; return false }
    override fun onStopJob(params: JobParameters) = false
    companion object {
        fun schedule(context: Context) { context.getSystemService(JobScheduler::class.java).schedule(JobInfo.Builder(141,ComponentName(context,CleanupJob::class.java)).setPeriodic(15*60_000L).build()) }
    }
}
