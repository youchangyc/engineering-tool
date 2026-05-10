# 工程图识别 Web App

React + Three.js + DeepSeek API 工程图识别工具。上传图片或 PDF 后，应用会调用 DeepSeek API，按根目录 `prompt.txt` 的系统提示词提取零件信息、尺寸和特征，并在右侧实时生成 3D 预览。

## 开发

```bash
npm install
npm run dev
```

## 环境变量

复制 `.env.example` 为 `.env`，填写：

```bash
VITE_DEEPSEEK_KEY=your_deepseek_api_key_here
```

## 构建

```bash
npm run build
```

构建产物会生成在 `dist/`，可作为静态文件部署。

## 识别输出格式

DeepSeek 返回 JSON，应用会尽量解析为：

```json
{
  "partName": "零件名称",
  "drawingNumber": "图号",
  "material": "材质",
  "weight": "重量",
  "dimensions": {
    "length": 120,
    "width": 80,
    "height": 30
  },
  "features": [
    { "name": "孔", "type": "hole", "size": 12, "quantity": 4 }
  ],
  "shapeType": "block"
}
```
