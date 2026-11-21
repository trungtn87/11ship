import Foundation

enum ReportOutcome {
    case uploaded(atWallMs: Int64, shouldShare: Bool?, intentOnline: Bool?)
    case failed
    case refused
    case sessionEnded
    case notNeeded
}

/// Sends the Shipper's LATEST position to the server (PUT /v1/driver/location), like LocationReporter.kt: one uploader, only the latest fix is kept
/// (no queue, no trail), the token is read from the Keychain for each request and never copied or logged, a 401 means the session is over.
final class LocationReporter {
    private let queue = DispatchQueue(label: "m14-report")
    private let session: URLSession
    private let onOutcome: (ReportOutcome) -> Void
    private let stopGraceMs: Int64 = 90_000

    private var base: String?
    private var fingerprint: String?
    private var startedAtMs: Int64 = 0
    private var generation = 0
    private var inFlight = false
    private var pending: Fix?
    private var latest: Fix?
    private var lastSentMs: Int64 = Int64.min
    private var retried = false
    private var task: URLSessionDataTask?

    init(onOutcome: @escaping (ReportOutcome) -> Void) {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        config.httpCookieStorage = nil
        session = URLSession(configuration: config)
        self.onOutcome = onOutcome
    }

    private static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    var running: Bool { queue.sync { base != nil } }

    func start(base: String, fingerprint: String) {
        queue.sync {
            generation += 1
            self.base = base.hasSuffix("/") ? String(base.dropLast()) : base
            self.fingerprint = fingerprint
            startedAtMs = Self.nowMs()
            inFlight = false
            pending = nil
            latest = nil
            lastSentMs = Int64.min
            retried = false
        }
    }

    /// Cancels what is waiting and what is in flight; whatever answers later is ignored.
    func stop() {
        queue.sync {
            generation += 1
            base = nil
            fingerprint = nil
            pending = nil
            latest = nil
            inFlight = false
            task?.cancel()
            task = nil
        }
    }

    func submit(_ fix: Fix) {
        queue.async {
            guard self.base != nil, ReportRules.valid(fix, nowMs: Self.nowMs()), fix.measuredAtMs > self.lastSentMs else { return }
            self.latest = fix
            self.retried = false
            self.pending = fix
            self.kick()
        }
    }

    /// One quick retry of the latest fix after a failure, only while it is still recent.
    func retryLatest() {
        queue.async {
            guard self.base != nil, let fix = self.latest, !self.retried, fix.measuredAtMs > self.lastSentMs, ReportRules.valid(fix, nowMs: Self.nowMs()) else { return }
            self.retried = true
            self.pending = fix
            self.kick()
        }
    }

    private func kick() {
        if inFlight { return }
        guard let fix = pending, let target = base, let expected = fingerprint else { return }
        pending = nil
        inFlight = true
        let gen = generation
        guard let token = SessionLink.token(), ReportRules.fingerprint(token) == expected else {
            finish(gen, stopsSharing: true, .sessionEnded)
            return
        }
        guard let url = URL(string: target + "/v1/driver/location") else { finish(gen, stopsSharing: false, .failed); return }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("Bearer " + token, forHTTPHeaderField: "authorization")
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "content-type")
        request.httpBody = ReportRules.body(fix)
        let started = session.dataTask(with: request) { data, response, error in
            self.queue.async {
                guard gen == self.generation, self.base != nil else { return }
                guard error == nil, let http = response as? HTTPURLResponse else { self.finish(gen, stopsSharing: false, .failed); return }
                switch http.statusCode {
                case 200:
                    let json = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any]
                    let shouldShare = json?["should_share_location"] as? Bool
                    let intentOnline = json?["intent_online"] as? Bool
                    self.lastSentMs = max(self.lastSentMs, fix.measuredAtMs)
                    let grace = Self.nowMs() - self.startedAtMs < self.stopGraceMs
                    self.onOutcome(.uploaded(atWallMs: Self.nowMs(), shouldShare: shouldShare, intentOnline: intentOnline))
                    if shouldShare == false && !grace { self.finish(gen, stopsSharing: true, .notNeeded) } else { self.finish(gen, stopsSharing: false, nil) }
                case 401:
                    self.finish(gen, stopsSharing: true, .sessionEnded)
                case 400...499:
                    self.finish(gen, stopsSharing: false, .refused)
                default:
                    self.finish(gen, stopsSharing: false, .failed)
                }
            }
        }
        task = started
        started.resume()
    }

    /// Ends one send; a newer waiting fix goes out next. A stop of sharing forgets the link.
    private func finish(_ gen: Int, stopsSharing: Bool, _ outcome: ReportOutcome?) {
        guard gen == generation else { return }
        inFlight = false
        task = nil
        if stopsSharing {
            generation += 1
            base = nil
            fingerprint = nil
            pending = nil
            latest = nil
        }
        if let outcome = outcome { onOutcome(outcome) }
        if !stopsSharing { kick() }
    }
}
