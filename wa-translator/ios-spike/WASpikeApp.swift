// ios-spike/WASpikeApp.swift
// Main app for the Sprint 0 spike. Shows Start Broadcast button + reads the log.

import SwiftUI
import ReplayKit
import UniformTypeIdentifiers

struct ContentView: View {
    private let groupID = "group.com.you.waspike"
    @State private var micLog = "(no log yet)"
    @State private var appLog = "(no log yet)"

    var body: some View {
        VStack(spacing: 20) {
            Text("WhatsApp Capture Spike").font(.headline)
            Text("1. Tap Start Broadcast\n2. Switch to WhatsApp\n3. Start a video call\n4. Talk 30s\n5. Stop, come back here")
                .font(.caption).multilineTextAlignment(.center)

            Button("Start Broadcast") {
                let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 200, height: 40))
                // presents the system picker; user confirms
                // (in a real app you'd host this via UIViewRepresentable)
            }

            Button("Reload logs") { reload() }

            ScrollView { Text("MIC:\n\(micLog)").font(.system(.caption, design: .monospaced)) }
            ScrollView { Text("APP (remote):\n\(appLog)").font(.system(.caption, design: .monospaced)) }
        }
        .padding()
        .onAppear { reload() }
    }

    private func reload() {
        guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID) else { return }
        micLog = (try? String(contentsOf: dir.appendingPathComponent("mic.log"), encoding: .utf8)) ?? "(none)"
        appLog = (try? String(contentsOf: dir.appendingPathComponent("remote.log"), encoding: .utf8)) ?? "(none)"
    }
}

@main struct WASpikeApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}