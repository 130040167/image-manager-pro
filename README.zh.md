<p align="center">
  <img width="112" src="./assets/logo.png" alt="Image Manager Pro 图标" />
</p>

<h1 align="center">Image Manager Pro</h1>

<p align="center">在 VS Code 中浏览、检查、编辑和测量图片。</p>

[English](./README.md)

Image Manager Pro 将工作区图片管理与图片编辑器集成到 VS Code，兼顾日常图片素材和科研图像数据。

从整理一组图片，到查看单个像素的颜色、通过直方图突出细微结构、测量图像特征，再到完成简单编辑与标注，都可以在当前工作区中进行。

## 图片管理

按文件夹浏览图片，支持搜索、筛选、排序和多选操作。通过批量压缩、格式转换和相似图片查找，整理工作区中的图片资源。

![工作区图片管理首页](./screenshots/release/home.png)

## 图片预览

通过缩放和平移观察局部细节，支持旋转、翻转视图和查看图片元数据。除常见图片格式和 TIFF 外，还可查看 NPY 与可配置的原始二进制图像。原始数据预设可指定尺寸、数据类型等解码参数。

![图片预览与检查工具](./screenshots/release/preview.png)

### 放大查看每个像素

- 查看当前像素的坐标以及 RGBA 颜色数值。
- 放大到一定程度后显示像素网格，并直接在像素上显示灰度值或 RGB 数值，便于检查边缘、色差和局部细节。
- 结合直方图调整时，可切换原始值与显示调整后的值，区分源图像数据和屏幕上的显示效果。

### 直方图与图像阈值

- 查看 RGB 或灰度直方图，了解图像的亮度与颜色分布。
- 拖动上下限，或直接输入数值，调整显示范围，突出低对比度区域中的细节。
- 将上下限设为同一数值时，可得到二值阈值显示，辅助观察不同亮度区域的分界。
- 调整过程中可结合原始与调整后像素模式进行检查。这些功能用于图像观察，不包含自动分割统计。

![预览直方图与像素检查](./screenshots/release/preview-details.png)

## 图片编辑

完成常见的轻量编辑：裁剪、旋转、添加文字、绘制形状和箭头、画笔与马赛克，以及亮度、对比度、饱和度、模糊和灰度调整。支持管理标注对象与图层、切换可见性和锁定状态，并通过撤销和重做调整编辑结果。

![图片编辑、标注与测量](./screenshots/release/editor.png)

### 测量与标注

测量长度、角度，以及支持形状的周长和面积。长度与周长以像素为单位，面积以平方像素为单位，角度以度为单位。可设置小数精度、标注文字、颜色与背景，让测量结果在不同图片上保持清晰。

标注可显示名称、数值或两者，支持调整线段端点和角度圆弧，并分别配置周长与面积标签。结合像素读数和直方图，可在观察局部特征时直接完成测量记录。

![编辑测量标注与直方图](./screenshots/release/editor-measurements.png)

## 开始使用

打开工作区后，在命令面板运行 **Image Manager Pro**，也可通过文件夹右键菜单打开。默认快捷键为 Windows/Linux 的 `Shift+Alt+J`、macOS 的 `Cmd+Alt+J`。

在扩展设置中将语言（`image-manager.appearance.language`）设为 **English** 或 **简体中文**，即可切换界面语言。编辑器工具、属性、颜色面板及测量标注会即时更新，并保留当前编辑状态；自定义名称和已有文字保持原文。

图片处理使用 Sharp 及对应平台的原生依赖。扩展可在需要时下载这些依赖，首次配置需要网络连接；可处理和转换的格式取决于可用的原生编解码器。NPY 与原始二进制格式需要匹配的数据及解码设置。

打包和发布步骤见 [RELEASING.md](./RELEASING.md)。

## 致谢

**本项目基于 hemengke1997（Minko）的 [Image Manager](https://github.com/hemengke1997/vscode-image-manager) 开发。** 原仓库的源码与设计构成了本扩展的基础，特别感谢原作者及贡献者的开源工作。

编辑器采用并改造了 ximing 的 [fabric-photo](https://github.com/ximing/fabric-photo) 代码。同时保留 Image Manager 原项目对 [vscode-image-viewer](https://github.com/ZhangJian1713/vscode-image-viewer) 和 [vscode-svgo](https://github.com/1000ch/vscode-svgo) 的致谢。

## 开源协议

项目代码采用 [MIT 协议](./LICENSE)。第三方组件保留各自的许可证，详见 [第三方声明](./THIRD_PARTY_NOTICES.md)。
