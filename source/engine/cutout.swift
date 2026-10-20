// Lifts the subjects of each image off its background with Vision and writes them as a transparent PNG.
// Usage: swift cutout.swift <image> <output.png> [<image> <output.png> ...]

import CoreImage
import Foundation
import Vision

let pairs = Array(CommandLine.arguments.dropFirst())
guard !pairs.isEmpty, pairs.count % 2 == 0 else {
    FileHandle.standardError.write("usage: cutout.swift <image> <output.png> [<image> <output.png> ...]\n".data(using: .utf8)!)
    exit(2)
}

let context = CIContext()
var failed = false
for index in stride(from: 0, to: pairs.count, by: 2) {
    let input = URL(fileURLWithPath: pairs[index])
    let output = URL(fileURLWithPath: pairs[index + 1])
    do {
        let handler = VNImageRequestHandler(url: input)
        let request = VNGenerateForegroundInstanceMaskRequest()
        try handler.perform([request])
        guard let result = request.results?.first else {
            FileHandle.standardError.write("\(input.path): no subject found\n".data(using: .utf8)!)
            failed = true
            continue
        }
        let masked = try result.generateMaskedImage(ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: false)
        try context.writePNGRepresentation(of: CIImage(cvPixelBuffer: masked), to: output, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    } catch {
        FileHandle.standardError.write("\(input.path): \(error.localizedDescription)\n".data(using: .utf8)!)
        failed = true
    }
}
exit(failed ? 1 : 0)
