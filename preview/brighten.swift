// preview/brighten.swift — 用 CoreImage 逐张提亮 CC0 油画缩略图
// 用法：swift preview/brighten.swift <file1.jpg> <file2.jpg> ...
// 只在本机生成缩略图时调用；产物（提亮后的 jpg）随仓库提交，运行时不需要本脚本。

import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers

let files = Array(CommandLine.arguments.dropFirst())
guard !files.isEmpty else {
    print("brighten: 0 files")
    exit(0)
}

let context = CIContext(options: nil)
var done = 0

func averageLuminance(_ image: CIImage, _ context: CIContext) -> Double {
    guard let avg = CIFilter(name: "CIAreaAverage", parameters: [
        kCIInputImageKey: image,
        kCIInputExtentKey: CIVector(cgRect: image.extent)
    ])?.outputImage else { return 80 }
    var pixel = [UInt8](repeating: 0, count: 4)
    context.render(avg, toBitmap: &pixel, rowBytes: 4,
                   bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
                   format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
    return 0.2126 * Double(pixel[0]) + 0.7152 * Double(pixel[1]) + 0.0722 * Double(pixel[2])
}

for path in files {
    let url = URL(fileURLWithPath: path)
    guard let input = CIImage(contentsOf: url) else { continue }

    // 自适应：暗画才抬暗部，本来就明亮的画几乎不动，避免整排卡面过曝发白。
    let lum = averageLuminance(input, context)
    let gammaPower: Double
    let ev: Double
    if lum < 55 {
        gammaPower = 0.66; ev = 0.14
    } else if lum < 100 {
        gammaPower = 0.80; ev = 0.05
    } else {
        gammaPower = 0.92; ev = 0.0
    }

    guard let gamma = CIFilter(name: "CIGammaAdjust") else { continue }
    gamma.setValue(input, forKey: kCIInputImageKey)
    gamma.setValue(gammaPower, forKey: "inputPower")

    guard let exposure = CIFilter(name: "CIExposureAdjust"),
          let gammaOut = gamma.outputImage else { continue }
    exposure.setValue(gammaOut, forKey: kCIInputImageKey)
    exposure.setValue(ev, forKey: "inputEV")

    guard let color = CIFilter(name: "CIColorControls"),
          let exposureOut = exposure.outputImage else { continue }
    color.setValue(exposureOut, forKey: kCIInputImageKey)
    color.setValue(1.08, forKey: "inputSaturation")
    color.setValue(1.02, forKey: "inputContrast")
    color.setValue(0.0, forKey: "inputBrightness")

    guard let output = color.outputImage,
          let cgImage = context.createCGImage(output, from: input.extent) else { continue }

    guard let dest = CGImageDestinationCreateWithURL(
        url as CFURL, UTType.jpeg.identifier as CFString, 1, nil
    ) else { continue }
    let props = [kCGImageDestinationLossyCompressionQuality: 0.52] as CFDictionary
    CGImageDestinationAddImage(dest, cgImage, props)
    if CGImageDestinationFinalize(dest) { done += 1 }
}

print("brighten: \(done)/\(files.count) files")
