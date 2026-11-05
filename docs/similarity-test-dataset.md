# Similarity Test Dataset

The generated similarity dataset is intentionally not committed. It contains many binary images and is reproducible from source.

Generate or refresh it with:

```bash
npx tsx scripts/generate-similarity-fixtures.ts --clean --out "D:\华为家庭存储\mySpace\learning\图像分割\数据集\image-manager-custom-format-test"
```

The script writes:

- `manifest.json`: source, variant, unrelated, and expected-match metadata.
- `complex-scene/`, `simple-shapes/`, `document-layout/`, `complex-texture/`: source images plus resize, compression, brightness/contrast, blur, noise, crop, color-shift, format-conversion, text, and occlusion variants.
- `luminance-trap/` and `unrelated/`: false-positive controls.

Automated tests import the same generator and call the production `Similarity.findSimilar()` implementation against real image files.
