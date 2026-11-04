import type { LayerConfig } from '@/types/api';
import type { TileGeometry } from './geometry';
import type { Viewport } from './viewport';

const VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_position;
uniform vec2 u_offset;
uniform vec2 u_scale;
void main() {
  vec2 clip = (a_position + u_offset) * u_scale;
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 outColor;
void main() { outColor = u_color; }`;

interface BufferEntry {
  buffer: WebGLBuffer;
  vao: WebGLVertexArrayObject;
  count: number;
}

interface RenderFrame {
  geometries: TileGeometry[];
  layers: LayerConfig[];
  viewport: Viewport;
  width: number;
  height: number;
  dpr: number;
}

export class WebGLRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private positionLocation: number;
  private offsetLocation: WebGLUniformLocation | null;
  private scaleLocation: WebGLUniformLocation | null;
  private colorLocation: WebGLUniformLocation | null;
  private buffers = new Map<Float32Array, BufferEntry>();
  private readonly maxBuffers = 640;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: false, stencil: false });
    if (!gl) throw new Error('当前浏览器或显卡不支持 WebGL2，无法渲染版图');
    this.gl = gl;
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error('无法创建 WebGL 渲染程序');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`WebGL 链接失败：${gl.getProgramInfoLog(program)}`);
    this.program = program;
    this.positionLocation = gl.getAttribLocation(program, 'a_position');
    this.offsetLocation = gl.getUniformLocation(program, 'u_offset');
    this.scaleLocation = gl.getUniformLocation(program, 'u_scale');
    this.colorLocation = gl.getUniformLocation(program, 'u_color');
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
  }

  render({ geometries, layers, viewport, width, height, dpr }: RenderFrame) {
    const gl = this.gl;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.clearColor(0.035, 0.055, 0.063, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(this.scaleLocation, 2 * viewport.scale / width, 2 * viewport.scale / height);

    for (const layer of layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      const [r, g, b] = hexToRgb(layer.color);
      gl.uniform4f(this.colorLocation, r, g, b, layer.opacity);
      for (const geometry of geometries) {
        const vertices = geometry.layerVertices.get(layer.layer_index);
        if (!vertices?.length) continue;
        const entry = this.getBuffer(vertices);
        gl.bindVertexArray(entry.vao);
        gl.uniform2f(
          this.offsetLocation,
          geometry.tile.origin[0] - viewport.center[0],
          geometry.tile.origin[1] - viewport.center[1],
        );
        gl.drawArrays(gl.TRIANGLES, 0, entry.count);
      }
    }
    gl.bindVertexArray(null);
  }

  private getBuffer(vertices: Float32Array) {
    const cached = this.buffers.get(vertices);
    if (cached) {
      this.buffers.delete(vertices);
      this.buffers.set(vertices, cached);
      return cached;
    }
    const gl = this.gl;
    const buffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!buffer || !vao) throw new Error('WebGL GPU Buffer 分配失败');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
    const entry = { buffer, vao, count: vertices.length / 2 };
    this.buffers.set(vertices, entry);
    while (this.buffers.size > this.maxBuffers) {
      const oldestKey = this.buffers.keys().next().value as Float32Array | undefined;
      if (!oldestKey) break;
      const oldest = this.buffers.get(oldestKey);
      if (oldest) { gl.deleteBuffer(oldest.buffer); gl.deleteVertexArray(oldest.vao); }
      this.buffers.delete(oldestKey);
    }
    return entry;
  }

  dispose() {
    this.buffers.forEach((entry) => {
      this.gl.deleteBuffer(entry.buffer);
      this.gl.deleteVertexArray(entry.vao);
    });
    this.buffers.clear();
    this.gl.deleteProgram(this.program);
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('无法创建 WebGL Shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`WebGL Shader 编译失败：${log}`);
  }
  return shader;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', '').slice(0, 6), 16);
  if (!Number.isFinite(value)) return [0.4, 0.66, 0.63];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
