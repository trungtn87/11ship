package vn.eleven.m14.history

import org.junit.Assert.*
import org.junit.Test

class TrackRulesTest {
    private val origin=TrackPoint(22.665,106.257,5f,1_000_000,1)
    @Test fun plausibleMovementRemainsOneSegment() { assertFalse(TrackRules.split(origin,origin.copy(lat=22.666,time=1_060_000))) }
    @Test fun outageAndImpossibleJumpBreakTheTrack() {
        assertTrue(TrackRules.split(origin,origin.copy(time=1_181_000)))
        assertTrue(TrackRules.split(origin,origin.copy(lat=23.0,time=1_060_000)))
        assertTrue(TrackRules.split(origin,origin.copy(time=1_000_000)))
    }
    @Test fun poorAccuracyCannotInflateTravelledDistance() { assertTrue(TrackRules.split(origin,origin.copy(accuracy=300f,time=1_060_000))) }
}
