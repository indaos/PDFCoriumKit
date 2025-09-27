

import SwiftUI

struct ContentView: View {
    @State private var pickedURL: URL?
    @State private var isPickerPresented = false

    var body: some View {
        VStack {
            if let url = pickedURL {
                PDFViewerView(url: url)
            } else {
                VStack(spacing: 16) {
                    Text("Open a PDF to begin")
                    Button("Open PDF") { isPickerPresented = true }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .sheet(isPresented: $isPickerPresented) {
            DocumentPicker { url in
                isPickerPresented = false
                pickedURL = url
            }
        }
    }
}

