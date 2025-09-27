import SwiftUI
import UIKit

final class PDFPageCanvasView: UIView, UIScrollViewDelegate, UIGestureRecognizerDelegate {
    let imageView = UIImageView()
    let scrollView = UIScrollView()
    var onTap: ((CGPoint) -> Void)?
    var onDragBegan: ((CGPoint) -> Void)?
    var onDragMoved: ((CGPoint) -> Void)?
    var onDragEnded: ((CGPoint) -> Void)?
    var onZoomChanged: ((CGFloat) -> Void)?
    var capturePan: Bool = false { didSet { } }

    var editorTextField: UITextField?
    var isEditingInline: Bool = false

    private let pathLayer = CAShapeLayer()
    private let rectLayer = CAShapeLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        scrollView.delegate = self
        scrollView.minimumZoomScale = 1.0
        scrollView.maximumZoomScale = 6.0
        scrollView.bouncesZoom = true
        addSubview(scrollView)
        scrollView.addSubview(imageView)

        let tap = UITapGestureRecognizer(target: self, action: #selector(tapAction(_:)))
        scrollView.addGestureRecognizer(tap)

        let pan = UIPanGestureRecognizer(target: self, action: #selector(panAction(_:)))
        pan.maximumNumberOfTouches = 1
        pan.minimumNumberOfTouches = 1
        pan.delegate = self
        scrollView.addGestureRecognizer(pan)

        pathLayer.name = "overlay.path"
        pathLayer.strokeColor = UIColor.black.withAlphaComponent(0.8).cgColor
        pathLayer.fillColor = UIColor.clear.cgColor
        pathLayer.lineWidth = 2
        rectLayer.name = "overlay.rect"
        rectLayer.strokeColor = UIColor.systemBlue.withAlphaComponent(0.9).cgColor
        rectLayer.fillColor = UIColor.clear.cgColor
        rectLayer.lineWidth = 1
        rectLayer.lineDashPattern = [6, 3]
        imageView.layer.addSublayer(rectLayer)
        imageView.layer.addSublayer(pathLayer)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        scrollView.frame = bounds
        imageView.frame = CGRect(origin: .zero, size: imageView.image?.size ?? .zero)
        scrollView.contentSize = imageView.frame.size
        pathLayer.frame = imageView.bounds
        rectLayer.frame = imageView.bounds
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { onZoomChanged?(scrollView.zoomScale) }

    @objc private func tapAction(_ g: UITapGestureRecognizer) {
        let p = g.location(in: imageView)
        onTap?(p)
    }

    @objc private func panAction(_ g: UIPanGestureRecognizer) {
        let p = g.location(in: imageView)
        switch g.state {
        case .began: onDragBegan?(p)
        case .changed: onDragMoved?(p)
        case .ended, .cancelled: onDragEnded?(p)
        default: break
        }
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        if capturePan { return false }
        return true
    }
}

struct PDFPageCanvas: UIViewRepresentable {
    var image: UIImage?
    var onTap: ((CGPoint) -> Void)?
    var onDragBegan: ((CGPoint) -> Void)?
    var onDragMoved: ((CGPoint) -> Void)?
    var onDragEnded: ((CGPoint) -> Void)?
    var onZoomChanged: ((CGFloat) -> Void)?
    var disableScroll: Bool = false
    var previewPathPoints: [CGPoint]? = nil
    var previewRect: CGRect? = nil
    var overlayRects: [CGRect] = []
    @Binding var editorText: String
    var isEditing: Bool = false
    var editorRect: CGRect? = nil
    var editorFontSize: CGFloat? = nil
    var editorTextColor: UIColor? = nil
    var onEditorCommit: (() -> Void)? = nil
    var onEditorCancel: (() -> Void)? = nil

    func makeUIView(context: Context) -> PDFPageCanvasView {
        let v = PDFPageCanvasView()
        v.onTap = onTap
        v.onDragBegan = onDragBegan
        v.onDragMoved = onDragMoved
        v.onDragEnded = onDragEnded
        v.onZoomChanged = onZoomChanged
        v.imageView.contentMode = .scaleAspectFit
        v.imageView.image = image
        return v
    }

    func updateUIView(_ uiView: PDFPageCanvasView, context: Context) {
        uiView.imageView.image = image
        uiView.scrollView.isScrollEnabled = !disableScroll
        uiView.capturePan = disableScroll

        if let pts = previewPathPoints, pts.count > 1 {
            let p = UIBezierPath()
            p.move(to: pts[0])
            for i in 1..<pts.count { p.addLine(to: pts[i]) }
            if let pathLayer = uiView.imageView.layer.sublayers?.first(where: { $0.name == "overlay.path" }) as? CAShapeLayer {
                pathLayer.path = p.cgPath
            }
        } else {
            if let pathLayer = uiView.imageView.layer.sublayers?.first(where: { $0.name == "overlay.path" }) as? CAShapeLayer {
                pathLayer.path = nil
            }
        }

        let rectPath = UIBezierPath()
        if !overlayRects.isEmpty {
            overlayRects.forEach { rectPath.append(UIBezierPath(rect: $0)) }
        }
        if let r = previewRect {
            rectPath.append(UIBezierPath(rect: r))
        }
        if let rectLayer = uiView.imageView.layer.sublayers?.first(where: { $0.name == "overlay.rect" }) as? CAShapeLayer {
            rectLayer.path = rectPath.cgPath
        }


        if isEditing, let r = editorRect {
            let tf: UITextField
            if let existing = uiView.editorTextField {
                tf = existing
            } else {
                tf = UITextField(frame: r)
                tf.borderStyle = .roundedRect
                tf.backgroundColor = UIColor.white.withAlphaComponent(0.95)
                tf.returnKeyType = .done
                tf.clearButtonMode = .whileEditing
                tf.layer.masksToBounds = true
                tf.layer.cornerRadius = 4
                tf.layer.borderColor = UIColor.systemBlue.withAlphaComponent(0.6).cgColor
                tf.layer.borderWidth = 1
                tf.adjustsFontSizeToFitWidth = true
                tf.minimumFontSize = 6
                tf.addTarget(context.coordinator, action: #selector(Coordinator.textChanged(_:)), for: .editingChanged)
                tf.addTarget(context.coordinator, action: #selector(Coordinator.editingDidEnd(_:)), for: .editingDidEnd)
                tf.addTarget(context.coordinator, action: #selector(Coordinator.commitFromReturn(_:)), for: .editingDidEndOnExit)
                uiView.imageView.addSubview(tf)
                uiView.editorTextField = tf
            }
            tf.frame = r
            if tf.text != editorText { tf.text = editorText }

            let sz = editorFontSize ?? max(10, min(r.height * 0.55, 48))
            if tf.font?.pointSize != sz {
                if let font = UIFont(name: "Helvetica", size: sz) {
                    tf.font = font
                } else {
                    tf.font = UIFont.systemFont(ofSize: sz)
                }
            }
            if let color = editorTextColor { tf.textColor = color }
            if !uiView.isEditingInline {
                uiView.isEditingInline = true
                tf.becomeFirstResponder()

                let insetRect = r.insetBy(dx: -16, dy: -16)
                uiView.scrollView.scrollRectToVisible(insetRect, animated: true)
            }
        } else {
            if let tf = uiView.editorTextField {
                tf.resignFirstResponder()
                tf.removeFromSuperview()
                uiView.editorTextField = nil
                uiView.isEditingInline = false
            }
        }
        uiView.setNeedsLayout()
        uiView.layoutIfNeeded()
    }

    func makeCoordinator() -> Coordinator { Coordinator(editorText: $editorText, onCommit: onEditorCommit, onCancel: onEditorCancel) }

    class Coordinator: NSObject {
        var editorText: Binding<String>
        var onCommit: (() -> Void)?
        var onCancel: (() -> Void)?
        init(editorText: Binding<String>, onCommit: (() -> Void)?, onCancel: (() -> Void)?) {
            self.editorText = editorText
            self.onCommit = onCommit
            self.onCancel = onCancel
        }

        @objc func textChanged(_ sender: UITextField) {
            editorText.wrappedValue = sender.text ?? ""
        }

        @objc func editingDidEnd(_ sender: UITextField) {

            
        }

        @objc func commitFromReturn(_ sender: UITextField) {
            onCommit?()
        }
    }
}
