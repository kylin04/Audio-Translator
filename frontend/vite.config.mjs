
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const sourceInfoPlugin = () => ({
  name: 'vite-plugin-source-info',
  enforce: 'pre',
  transform(code, id) {
    // 1. 过滤逻辑：只处理源码，排除 node_modules
    if (id.includes('node_modules') || !/\.(vue|jsx|tsx|html)$/.test(id)) return;

    const path = id.replace(process.cwd(), '');
    const lineOffsets = [0]; // 初始化行偏移
    for (let i = 0; i < code.length; i++) {
      if (code[i] === '\n') lineOffsets.push(i + 1);
    }

    const newCode = code.replace(/<([a-zA-Z][a-zA-Z0-9\.\-:]*)(?=[\s>])/g, (match, tag, offset) => {
      // 检查是否在引号内部（防止破坏 href 中的 SVG）
      const preCode = code.substring(0, offset);
      const quoteCount = (preCode.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) return match;

      // 排除不需要注入的标签（如 script, style, template, meta 等）
      const lowerTag = tag.toLowerCase();
      const ignoreTags = ['script', 'style', 'template', 'link', 'meta', 'base', 'doctype'];
      if (ignoreTags.includes(lowerTag)) return match;
      
      // 计算行列
      let lineIdx = lineOffsets.findIndex(s => s > offset) - 1;
      if (lineIdx === -2) lineIdx = lineOffsets.length - 1;
      const line = lineIdx + 1;
      const col = offset - (lineOffsets[lineIdx] || 0) + 1;

      // 返回：完整匹配的标签名 + 注入的属性
      return `${match} data-src-path="${path}" data-src-line="${line}" data-src-col="${col}"`;
    });

    return { code: newCode, map: null };
  }
});
        
export default defineConfig({ 
  root: './',
  base: './',
  plugins: [sourceInfoPlugin(),react({ 
    babel: { 
      presets: ['@babel/preset-react'],
      plugins: [
        ['@babel/plugin-transform-react-jsx', { 
          runtime: 'automatic' 
        }]
      ]
    }
  })],
  build: {
    outDir: 'public',
    assetsDir: 'assets'
  }
})
