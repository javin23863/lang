// ios-spike/SampleHandler.swift
// Sprint 0 spike: ReplayKit Broadcast Upload Extension.
// Goal: prove whether .audioApp samples during a WhatsApp video call are
// non-silent (i.e. contain the remote caller's voice).
//
// HOW TO USE (on a Mac with Xcode):
// 1. Create a new iOS App target "WASpike" (SwiftUI, iOS 17+).
// 2. Add a Broadcast Upload Extension target named "WASpikeBroadcast"
//    (File > New > Target > Broadcast Upload Extension). Language: Swift.
// 3. Replace the generated SampleHandler.swift with this file.
// 4. Enable an App Group: both targets, capability "App Groups",
//    group id "group.com.you.waspike".
// 5. Set the main app's Info.plist NSMicrophoneUsageDescription.
// 6. Run the main app on a real iPhone, tap Start Broadcast, switch to
//    WhatsApp, start a video call, talk for 30s, stop broadcast.
// 7. Back in the main app, read the log from the App Group container.
//
// PASS: remote.log shows non-zero RMS that varies when the remote party speaks.
// FAIL: remote.log is all zeros or constant.  -> pivot to Fallback B in SPEC-v3.

import ReplayKit
import UniformTypeIdentifiers

class SampleHandler: RPBroadcastSampleHandler {

    // App Group shared file URLs
    private let groupID = "group.com.you.waspike"
    private let micLogName  = "mic.log"
    private let appLogName  = "remote.log"

    private lazy var micURL: URL = {
        let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID)!
        return dir.appendingPathComponent(micLogName)
    }()
    private lazy var appURL: URL = {
        let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID)!
        return dir.appendingPathComponent(appLogName)
    }()

    private var micHandle: FileHandle?
    private var appHandle: FileHandle?

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        // truncate logs
        try? "".write(to: micURL, atomically: true, encoding: .utf8)
        try? "".write(to: appURL, atomically: true, encoding: .utf8)
        micHandle = try? FileHandle(forWritingTo: micURL)
        appHandle = try? FileHandle(forWritingTo: appURL)
        log(micHandle, "STARTED\n")
        log(appHandle, "STARTED\n")
    }

    override func broadcastPaused() { log(micHandle, "PAUSED\n"); log(appHandle, "PAUSED\n") }
    override func broadcastResumed() { log(micHandle, "RESUMED\n"); log(appHandle, "RESUMED\n") }
    override func broadcastFinished() {
        log(micHandle, "FINISHED\n"); log(appHandle, "FINISHED\n")
        micHandle?.closeFile(); appHandle?.closeFile()
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer,
                                      with sampleBufferType: RPSampleBufferType) {
        switch sampleBufferType {
        case .audioMic:
            logAudio(appHandleNamed: micHandle, tag: "MIC", sampleBuffer)
        case .audioApp:
            logAudio(appHandleNamed: appHandle, tag: "APP", sampleBuffer)
        default:
            break // ignore video
        }
    }

    private func logAudio(appHandleNamed h: FileHandle?, tag: String, _ s: CMSampleBuffer) {
        guard let h = h else { return }
        guard let block = CMSampleBufferGetDataBuffer(s) else { return }
        let n = CMBlockBufferGetDataLength(block)
        var pts = CMSampleBufferGetPresentationTimeStamp(s)
        let sr = CMSampleBufferGetSampleRate(s)
        let ch = CMSampleBufferGetNumChannels(s)

        // RMS from the raw PCM (assume 16-bit signed, mono/stereo)
        var rms: Float = 0
        var count: Int = 0
        CMBlockBufferGetDataBuffer(s)?.withContiguousStorage { (ptr: UnsafePointer<Int16>) in
            let frames = n / MemoryLayout<Int16>.size
            var sum: Double = 0
            for i in 0..<frames {
                let v = Double(ptr[i]) / 32768.0
                sum += v * v
            }
            rms = Float(sqrt(sum / Double(frames)))
            count = frames
        }
        let line = String(format: "%@ t=%.3f sr=%.0f ch=%d n=%d rms=%.5f\n",
                          tag, CMTimeGetSeconds(pts), sr, ch, count, rms)
        h.write(line.data(using: .utf8) ?? Data())
    }

    private func log(_ h: FileHandle?, _ s: String) {
        h?.write(s.data(using: .utf8) ?? Data())
    }
}