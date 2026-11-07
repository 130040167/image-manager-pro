# Image Manager Pro

Browse, inspect, measure and edit workspace images directly in VS Code.

Image Manager Pro is designed for the moment when a normal file preview is no longer enough: read a pixel's RGBA value, tune a histogram threshold, measure a feature, keep annotations editable, or process a group of images without leaving the editor.

## Workspace Gallery

Search filenames, browse folders, filter and sort the current view, select several images and open compression, conversion, rename or similarity tools from the same context menu.

![Workspace gallery](./screenshots/release/home.png)

## Preview Controls That Match The Task

![Image preview](./screenshots/release/preview.png)

- Switch the mouse wheel between zooming the current image and paging left or right through the folder.
- Use fit-to-window, reset-center, rotate, flip, zoom presets and direct percentage input.
- Keep side navigation visible while inspecting a single image.
- Open the editor, pixel inspector or histogram from the current preview.
- Preview common image formats together with TIFF, NPY and configurable raw binary data.

## Pixel Inspection And Thresholds

![Pixel inspection and histogram](./screenshots/release/preview-details.png)

- Read pixel coordinates and RGBA values at the pointer.
- Use the 5000% preset to see a pixel grid with grayscale or RGB labels.
- Compare raw values with values after the current display adjustment.
- View RGB or grayscale histograms.
- Drag or enter lower and upper bounds to reveal low-contrast structures.
- Set both bounds to the same value for a binary threshold view.

## An Editable Image Editor

![Image editor with layers](./screenshots/release/editor.png)

- Crop, rotate, adjust brightness, contrast, saturation, blur and grayscale.
- Add text, rectangles, circles, triangles, arrows, brush strokes and mosaic blocks.
- Keep every object in a layer list so it can be moved, restyled, hidden or locked later.
- Use undo and redo while refining an annotation.
- Export with a chosen format, scale, range and quality.

## Measurements That Stay Editable

![Editable measurements](./screenshots/release/editor-measurements.png)

Line, angle, polygon and ellipse measurements are stored as objects rather than flattened pixels.

- Drag measurement points and angle arcs after creation.
- Choose decimal precision and show the name, value or both.
- Configure label color, font, background and opacity.
- Configure perimeter and area labels independently.
- Lock a finished measurement to protect it from accidental edits.

## Filename Search

![Filename search](./screenshots/release/search.png)

Search as you type, use case-sensitive or whole-word matching, browse search history with the arrow keys, and open a match directly in preview or the editor.

## Compression And Conversion

![Compression settings](./screenshots/release/compression.png)

- Configure quality, compression level, scale, format, output path and original-file handling.
- Batch process selected images or a directory.
- Support PNG, JPG, JPEG, WebP, GIF, TIFF, AVIF and HEIF when the installed backend provides them.
- Skip files that are already compressed.

## Similarity Search

![Similarity search](./screenshots/release/similarity.png)

- Compare the current directory or all loaded directories.
- Choose hybrid, pHash, dHash, aHash or histogram algorithms.
- Tune the threshold and maximum result count.
- Use stricter thresholds for precision or higher thresholds to find more variants.

## Formats, Themes And Languages

Preview TIFF, NPY arrays and configurable raw binary data with the same pixel and histogram workflow. Choose **English** or **Simplified Chinese** with `image-manager.appearance.language`; editor labels update without recreating the canvas or losing custom names and existing text. Traditional Chinese, Japanese and German remain available for the main interface. Light and dark VS Code themes are supported.

## Get Started

Open a workspace containing images, then run **Image Manager Pro** from the Command Palette or a folder's Explorer context menu.

Default shortcut: `Shift+Alt+J` on Windows/Linux and `Cmd+Alt+J` on macOS.

Some operations use Sharp and platform-specific native dependencies. The extension can install them when enabled in settings; supported formats depend on the available codecs.

Project source, MIT licensing and upstream acknowledgments are available in the linked GitHub repository.
