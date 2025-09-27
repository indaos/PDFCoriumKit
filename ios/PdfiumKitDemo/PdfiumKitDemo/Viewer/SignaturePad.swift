import SwiftUI
import UIKit

final class SignatureCanvasView: UIView {
    private let path = UIBezierPath()
    private let shape = CAShapeLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        shape.strokeColor = UIColor.label.cgColor
        shape.fillColor = UIColor.clear.cgColor
        shape.lineWidth = 2
        layer.addSublayer(shape)
        path.lineJoinStyle = .round
        path.lineCapStyle = .round
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        shape.frame = bounds
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let p = touches.first?.location(in: self) else { return }
        path.move(to: p)
        shape.path = path.cgPath
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let p = touches.first?.location(in: self) else { return }
        path.addLine(to: p)
        shape.path = path.cgPath
    }

    func clear() {
        path.removeAllPoints()
        shape.path = path.cgPath
    }

    func exportImage() -> UIImage? {
        let renderer = UIGraphicsImageRenderer(bounds: bounds)
        return renderer.image { ctx in
            UIColor.clear.setFill()
            ctx.fill(bounds)
            shape.render(in: ctx.cgContext)
        }
    }
}

struct SignaturePad: UIViewRepresentable {
    @Binding var image: UIImage?
    @Binding var capture: Bool
    func makeUIView(context: Context) -> SignatureCanvasView { SignatureCanvasView() }
    func updateUIView(_ uiView: SignatureCanvasView, context: Context) {
        if capture {
            image = uiView.exportImage()
            DispatchQueue.main.async { capture = false }
        }
    }
    static func dismantleUIView(_ uiView: SignatureCanvasView, coordinator: ()) {}
}
