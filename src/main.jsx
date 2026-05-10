import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Box,
  Braces,
  Download,
  FileUp,
  Loader2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import * as THREE from 'three';
import systemPrompt from '../prompt.txt?raw';
import './styles.css';

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const emptyResult = {
  partName: '',
  drawingNumber: '',
  material: '',
  weight: '',
  shapeType: 'block',
  dimensions: {
    length: 120,
    width: 80,
    height: 30,
    diameter: 60,
    holeDiameter: 12,
  },
  features: [],
};

const shapeOptions = [
  { value: 'block', label: '矩形块' },
  { value: 'plate', label: '板件' },
  { value: 'cylinder', label: '圆柱/轴' },
  { value: 'bracket', label: '支架' },
];

function normalizeRecognition(raw) {
  const dimensions = raw.dimensions || raw['主要尺寸'] || raw.mainDimensions || {};
  const features = raw.features || raw['特征列表'] || raw.featureList || [];

  return {
    partName: raw.partName || raw['零件名称'] || raw.name || '',
    drawingNumber: raw.drawingNumber || raw['图号'] || raw.drawingNo || '',
    material: raw.material || raw['材质'] || '',
    weight: raw.weight || raw['重量'] || '',
    shapeType: raw.shapeType || raw['形状类型'] || raw.shape || 'block',
    dimensions: {
      ...emptyResult.dimensions,
      ...dimensions,
    },
    features: Array.isArray(features) ? features : [],
  };
}

function parseDeepSeekJson(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('DeepSeek 返回内容不是 JSON。');
  }
  return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function imageFileToJpegDataUrl(file) {
  const dataUrl = await fileToDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

async function pdfFirstPageToJpegDataUrl(file) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: context,
    viewport,
  }).promise;

  await pdf.destroy();
  return canvas.toDataURL('image/jpeg', 0.92);
}

async function fileToVisionImageUrl(file) {
  if (file.type.startsWith('image/')) {
    return imageFileToJpegDataUrl(file);
  }

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return pdfFirstPageToJpegDataUrl(file);
  }

  throw new Error('仅支持 PNG、JPG、WEBP 图片或 PDF 文件。');
}

async function recognizeDrawing(file) {
  const apiKey = import.meta.env.VITE_DEEPSEEK_KEY;
  if (!apiKey) {
    throw new Error('缺少 VITE_DEEPSEEK_KEY，请在 .env 中配置。');
  }

  const imageUrl = await fileToVisionImageUrl(file);
  const userContent = [
    {
      type: 'text',
      text:
        '请识别这份工程图，必须只返回 JSON。字段包含：零件名称、图号、材质、重量、主要尺寸、特征列表、形状类型。' +
        `文件名：${file.name}，MIME：${file.type || 'application/octet-stream'}。`,
    },
    {
      type: 'image_url',
      image_url: {
        url: imageUrl,
      },
    },
  ];

  const response = await fetch(DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            systemPrompt.trim() ||
            '你是工程图识别助手。请从工程图中提取结构化零件参数，只返回有效 JSON。',
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DeepSeek API 请求失败：${response.status} ${detail}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return normalizeRecognition(parseDeepSeekJson(content));
}

function createGeometry(shapeType, dimensions) {
  const length = Number(dimensions.length) || 120;
  const width = Number(dimensions.width) || 80;
  const height = Number(dimensions.height) || 30;
  const diameter = Number(dimensions.diameter) || Math.min(length, width);

  if (shapeType === 'cylinder') {
    return new THREE.CylinderGeometry(diameter / 2, diameter / 2, length, 48);
  }

  if (shapeType === 'plate') {
    return new THREE.BoxGeometry(length, Math.max(height, 8), width);
  }

  if (shapeType === 'bracket') {
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(length, height, width));
    base.position.y = height / 2;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(length, width, height));
    wall.position.set(0, width / 2, -width / 2 + height / 2);
    group.add(base, wall);
    return group;
  }

  return new THREE.BoxGeometry(length, height, width);
}

function PreviewScene({ result }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf6f8fb);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(180, 150, 220);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.72);
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(120, 160, 80);
    scene.add(ambient, key);

    const grid = new THREE.GridHelper(320, 16, 0x8ea0b8, 0xd4dbe6);
    grid.position.y = -2;
    scene.add(grid);

    const material = new THREE.MeshStandardMaterial({
      color: 0x4f7ecb,
      roughness: 0.42,
      metalness: 0.2,
    });

    let model;
    const setModel = () => {
      if (model) scene.remove(model);
      const shape = createGeometry(result.shapeType, result.dimensions);
      if (shape instanceof THREE.Group) {
        model = shape;
        model.traverse((child) => {
          if (child.isMesh) child.material = material;
        });
      } else {
        model = new THREE.Mesh(shape, material);
      }
      scene.add(model);
    };

    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };

    let frameId;
    const animate = () => {
      if (model) {
        model.rotation.y += 0.006;
        model.rotation.x = -0.18;
      }
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };

    resize();
    setModel();
    animate();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(frameId);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [result]);

  return <div className="previewCanvas" ref={mountRef} />;
}

function Field({ label, value, onChange, type = 'text', suffix }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="inputWrap">
        <input value={value ?? ''} type={type} onChange={(event) => onChange(event.target.value)} />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
  );
}

function App() {
  const [result, setResult] = useState(emptyResult);
  const [fileName, setFileName] = useState('');
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [error, setError] = useState('');

  const featureSummary = useMemo(() => {
    if (!result.features.length) return '暂无特征';
    return result.features
      .map((feature) => `${feature.name || feature.type || '特征'} x${feature.quantity || 1}`)
      .join(' / ');
  }, [result.features]);

  const updateRoot = (key, value) => {
    setResult((current) => ({ ...current, [key]: value }));
  };

  const updateDimension = (key, value) => {
    setResult((current) => ({
      ...current,
      dimensions: {
        ...current.dimensions,
        [key]: value,
      },
    }));
  };

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setIsRecognizing(true);
    setError('');

    try {
      const recognized = await recognizeDrawing(file);
      setResult(recognized);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsRecognizing(false);
    }
  };

  const downloadStep = () => {
    const d = result.dimensions;
    const step = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Engineering drawing recognition export'),'2;1');
FILE_NAME('${result.partName || 'part'}','${new Date().toISOString()}',('engineering-tool'),('engineering-tool'),'React Three.js','DeepSeek','');
ENDSEC;
DATA;
/* Part: ${result.partName || '未命名'} */
/* Drawing: ${result.drawingNumber || '未填写'} */
/* Material: ${result.material || '未填写'} */
/* Weight: ${result.weight || '未填写'} */
/* Shape: ${result.shapeType} */
/* Dimensions: length=${d.length}, width=${d.width}, height=${d.height}, diameter=${d.diameter}, holeDiameter=${d.holeDiameter} */
/* Features: ${JSON.stringify(result.features)} */
ENDSEC;
END-ISO-10303-21;`;

    const blob = new Blob([step], { type: 'model/step' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${result.drawingNumber || result.partName || 'engineering-part'}.step`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="appShell">
      <section className="toolbar">
        <div>
          <p className="eyebrow">Engineering Drawing AI</p>
          <h1>工程图识别与 3D 预览</h1>
        </div>
        <button className="ghostButton" onClick={() => setResult(emptyResult)} type="button">
          <RotateCcw size={18} />
          重置
        </button>
      </section>

      <section className="workspace">
        <aside className="leftPane">
          <label className="uploadBox">
            <FileUp size={26} />
            <strong>{fileName || '上传工程图'}</strong>
            <span>支持 PNG、JPG、WEBP、PDF</span>
            <input accept="image/*,.pdf,application/pdf" type="file" onChange={handleUpload} />
          </label>

          {isRecognizing ? (
            <div className="statusCard">
              <Loader2 className="spin" size={18} />
              DeepSeek 正在识别工程图...
            </div>
          ) : null}

          {error ? (
            <div className="errorCard">
              <Braces size={18} />
              {error}
            </div>
          ) : null}

          <div className="formGrid">
            <Field label="零件名称" value={result.partName} onChange={(v) => updateRoot('partName', v)} />
            <Field label="图号" value={result.drawingNumber} onChange={(v) => updateRoot('drawingNumber', v)} />
            <Field label="材质" value={result.material} onChange={(v) => updateRoot('material', v)} />
            <Field label="重量" value={result.weight} onChange={(v) => updateRoot('weight', v)} />

            <label className="field">
              <span>形状类型</span>
              <select value={result.shapeType} onChange={(event) => updateRoot('shapeType', event.target.value)}>
                {shapeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <Field label="长度" value={result.dimensions.length} type="number" suffix="mm" onChange={(v) => updateDimension('length', v)} />
            <Field label="宽度" value={result.dimensions.width} type="number" suffix="mm" onChange={(v) => updateDimension('width', v)} />
            <Field label="高度" value={result.dimensions.height} type="number" suffix="mm" onChange={(v) => updateDimension('height', v)} />
            <Field label="直径" value={result.dimensions.diameter} type="number" suffix="mm" onChange={(v) => updateDimension('diameter', v)} />
            <Field label="孔径" value={result.dimensions.holeDiameter} type="number" suffix="mm" onChange={(v) => updateDimension('holeDiameter', v)} />
          </div>

          <div className="featureBox">
            <Sparkles size={17} />
            <span>{featureSummary}</span>
          </div>
        </aside>

        <section className="rightPane">
          <div className="previewHeader">
            <div>
              <p className="eyebrow">Realtime Three.js</p>
              <h2>{result.partName || '未命名零件'}</h2>
            </div>
            <Box size={24} />
          </div>
          <PreviewScene result={result} />
        </section>
      </section>

      <footer className="downloadBar">
        <div>
          <strong>{result.drawingNumber || 'STEP 导出'}</strong>
          <span>基于当前表单参数生成部署友好的 STEP 文本文件</span>
        </div>
        <button className="primaryButton" onClick={downloadStep} type="button">
          <Download size={19} />
          下载 STEP 文件
        </button>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
