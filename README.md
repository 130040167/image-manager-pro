<p align="center">
  <img width="112" src="./assets/logo.png" alt="Image Manager Pro logo" />
</p>

<h1 align="center">Image Manager Pro</h1>

<p align="center">Browse, inspect, edit, and measure images in VS Code.</p>

[简体中文](./README.zh.md)

Image Manager Pro brings workspace image management and an image editor into VS Code, with tools for everyday assets and scientific image data.

Go from a folder of images to a closer look at the data: inspect a pixel's color, adjust the histogram range to reveal faint details, measure a feature, or make a quick annotated edit without leaving your workspace.

## Workspace Gallery

Browse images by folder, search, filter, and sort the gallery, then work on multiple selected files. Batch compression, format conversion, and similarity search help organize image collections.

![Workspace image gallery](./screenshots/release/home.png)

## Image Preview

Zoom and pan to examine fine details, rotate or flip the view, and check image metadata. Preview common image formats alongside TIFF and configurable NPY and raw binary image data. Raw data presets describe dimensions, data type, and other decoding options.

![Image preview with inspection tools](./screenshots/release/preview.png)

### Pixel-Level Inspection

- Read the pixel coordinates and RGBA color values at the inspected position.
- Zoom in far enough to see the pixel grid and numerical grayscale or RGB values directly over individual pixels.
- Switch between original and display-adjusted pixel values when working with histogram adjustments, so you can distinguish source values from the appearance on screen.

### Histograms and Thresholds

- Inspect RGB or grayscale distributions to understand the image's intensity range.
- Drag the lower and upper bounds, or enter numerical values, to adjust the displayed range and make low-contrast details easier to see.
- Set both bounds to the same value for a binary threshold display, useful for inspecting intensity boundaries.
- Compare original and adjusted pixel modes while exploring the image. These controls support visual inspection; they do not provide automated segmentation statistics.

![Preview histogram and pixel inspection](./screenshots/release/preview-details.png)

## Image Editor

Make everyday image edits in the same workspace: crop, rotate, add text, draw shapes and arrows, use a brush or mosaic, and adjust brightness, contrast, saturation, blur, or grayscale. Manage annotation objects and layers, change their visibility or lock state, and undo or redo edits.

![Image editor with annotations and measurements](./screenshots/release/editor.png)

### Measurements and Annotations

Measure lengths, angles, and the perimeter or area of supported shapes. Lengths and perimeters use pixels, areas use square pixels, and angles use degrees. Keep measurements readable with configurable decimal precision, label text, colors, and backgrounds.

Choose whether to show a measurement's name, value, or both; adjust line endpoints and angle arcs; and configure perimeter and area labels separately. Combine measurements with pixel and histogram inspection when documenting a feature in an image.

![Editor measurement annotations and histogram](./screenshots/release/editor-measurements.png)

## Getting Started

Open a workspace, run **Image Manager Pro** from the Command Palette, or open it from a folder's context menu. The default shortcut is `Shift+Alt+J` on Windows/Linux and `Cmd+Alt+J` on macOS.

Image processing uses Sharp and platform-specific native dependencies. The extension can download these dependencies when needed; the first setup requires network access. Supported processing and conversion formats depend on the available native codecs. NPY and raw binary formats require compatible data and decoding settings.

For packaging and publication steps, see [RELEASING.md](./RELEASING.md).

## Acknowledgments

**This project is based on [Image Manager](https://github.com/hemengke1997/vscode-image-manager) by hemengke1997 (Minko).** Its source code and design form the foundation of this extension. Special thanks to the original author and contributors for making this work possible.

The editor incorporates adapted code from [fabric-photo](https://github.com/ximing/fabric-photo) by ximing. We also retain Image Manager's original acknowledgments to [vscode-image-viewer](https://github.com/ZhangJian1713/vscode-image-viewer) and [vscode-svgo](https://github.com/1000ch/vscode-svgo).

## License

Project code is available under the [MIT License](./LICENSE). Third-party components retain their own licenses; see [Third-Party Notices](./THIRD_PARTY_NOTICES.md).
